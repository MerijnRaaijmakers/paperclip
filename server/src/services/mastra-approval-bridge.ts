/**
 * Mastra Approval Bridge.
 *
 * Bridges Mastra workflow suspend/resume with Paperclip's approval system.
 * When a Mastra workflow suspends, creates a Paperclip approval record.
 * When the approval is resolved, resumes the Mastra workflow.
 *
 * Also implements tiered approvals: manager agents can auto-approve
 * within their authority before escalating to humans.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals } from "@paperclipai/db";
import { resumeMastraWorkflow, generateMastraAgent } from "./mastra-client.js";
import { postApprovalRequest, postAutoApproval } from "./slack-activity.js";
import { logger } from "../middleware/logger.js";

const PAPERCLIP_BASE_URL = process.env.PAPERCLIP_BASE_URL ?? "http://localhost:3100";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowSuspendPayload {
  mastraWorkflowId: string;
  mastraRunId: string;
  stepId: string;
  suspendPayload: Record<string, unknown>;
}

export interface TieredApprovalResult {
  autoApproved: boolean;
  decidedByAgentId: string | null;
  reasoning: string | null;
  escalatedToHuman: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function mastraApprovalBridgeService(db: Db) {
  return {
    /**
     * Create a Paperclip approval record for a suspended Mastra workflow step.
     * Called when a Mastra workflow run returns status: "suspended".
     */
    createSuspendApproval: async (
      companyId: string,
      requestedByAgentId: string,
      payload: WorkflowSuspendPayload,
    ) => {
      const created = await db
        .insert(approvals)
        .values({
          companyId,
          type: "workflow_suspend",
          requestedByAgentId,
          status: "pending",
          payload: payload as unknown as Record<string, unknown>,
        })
        .returning()
        .then((rows) => rows[0]);

      logger.info(
        {
          approvalId: created.id,
          companyId,
          workflowId: payload.mastraWorkflowId,
          stepId: payload.stepId,
        },
        "mastra-approval-bridge: created suspend approval",
      );

      // Look up the requesting agent's mastraAgentId for Slack identity
      const requestingAgent = await db
        .select({ adapterConfig: agents.adapterConfig, name: agents.name })
        .from(agents)
        .where(eq(agents.id, requestedByAgentId))
        .then((rows) => rows[0] ?? null);
      const mastraAgentId = (requestingAgent?.adapterConfig as Record<string, unknown>)?.mastraAgentId as string ?? "unknown";
      const reason = payload.suspendPayload?.reason as string ?? payload.suspendPayload?.message as string ?? "Workflow requires approval";

      // Attempt tiered approval first (manager agents auto-approve if within authority)
      const tieredResult = await mastraApprovalBridgeService(db).attemptTieredApproval(
        created.id,
        requestedByAgentId,
        reason,
      );

      if (tieredResult.autoApproved) {
        // Post FYI to Slack
        void postAutoApproval(mastraAgentId, "Manager Agent", reason, tieredResult.reasoning ?? "").catch(() => {});
        // Resume the workflow
        await mastraApprovalBridgeService(db).resumeFromApproval({
          ...created,
          status: "approved",
          decisionNote: `Auto-approved: ${tieredResult.reasoning}`,
        });
      } else {
        // Post interactive approval request to Slack
        void postApprovalRequest(mastraAgentId, created.id, reason, PAPERCLIP_BASE_URL).catch(() => {});
      }

      return created;
    },

    /**
     * Resume a Mastra workflow after a Paperclip approval is resolved.
     * Called from the approvals service after approve/reject.
     */
    resumeFromApproval: async (
      approval: typeof approvals.$inferSelect,
    ) => {
      const payload = approval.payload as unknown as WorkflowSuspendPayload;
      if (!payload?.mastraWorkflowId || !payload?.stepId) {
        logger.warn({ approvalId: approval.id }, "mastra-approval-bridge: approval payload missing workflow/step info");
        return;
      }

      const approved = approval.status === "approved";
      const resumeData = {
        approved,
        note: approval.decisionNote ?? undefined,
        decidedBy: approval.decidedByUserId ?? undefined,
      };

      try {
        const result = await resumeMastraWorkflow(
          payload.mastraWorkflowId,
          payload.stepId,
          resumeData,
        );
        logger.info(
          {
            approvalId: approval.id,
            workflowId: payload.mastraWorkflowId,
            stepId: payload.stepId,
            approved,
            result,
          },
          "mastra-approval-bridge: resumed workflow",
        );
      } catch (err) {
        logger.error(
          {
            err,
            approvalId: approval.id,
            workflowId: payload.mastraWorkflowId,
          },
          "mastra-approval-bridge: failed to resume workflow",
        );
      }
    },

    /**
     * Attempt tiered approval through the org chart.
     * Walks up the reportsTo chain, asking manager agents if they can approve.
     * Returns auto-approved if a manager says YES, or escalates to human.
     */
    attemptTieredApproval: async (
      approvalId: string,
      requestingAgentId: string,
      reason: string,
    ): Promise<TieredApprovalResult> => {
      // Walk up the reportsTo chain
      const visited = new Set<string>([requestingAgentId]);
      let currentAgentId = requestingAgentId;

      for (let depth = 0; depth < 5; depth++) {
        // Find the manager
        const agent = await db
          .select({ id: agents.id, name: agents.name, reportsTo: agents.reportsTo, adapterConfig: agents.adapterConfig })
          .from(agents)
          .where(eq(agents.id, currentAgentId))
          .then((rows) => rows[0] ?? null);

        if (!agent?.reportsTo) break; // No manager → escalate to human
        if (visited.has(agent.reportsTo)) break; // Cycle detection
        visited.add(agent.reportsTo);

        const manager = await db
          .select({ id: agents.id, name: agents.name, adapterType: agents.adapterType, adapterConfig: agents.adapterConfig })
          .from(agents)
          .where(eq(agents.id, agent.reportsTo))
          .then((rows) => rows[0] ?? null);

        if (!manager) break;
        if (manager.adapterType !== "mastra_local") break; // Non-Mastra manager → escalate

        const mastraAgentId = (manager.adapterConfig as Record<string, unknown>)?.mastraAgentId;
        if (!mastraAgentId || typeof mastraAgentId !== "string") break;

        // Ask the manager agent for their opinion
        try {
          const response = await generateMastraAgent(mastraAgentId, [{
            role: "user",
            content: `You are being asked to approve a request from your team member.

**Request**: ${reason}

As a manager, evaluate this request. Consider:
- Is this within normal operating parameters?
- Does this require human oversight?
- Are there any risks?

Respond with exactly one of:
- "APPROVE: [your reasoning]" if you approve
- "ESCALATE: [your reasoning]" if this needs human review

Do not add any other text.`,
          }]);

          const text = response.text.trim();
          if (text.startsWith("APPROVE:")) {
            const reasoning = text.slice("APPROVE:".length).trim();

            // Auto-approve: update the approval record
            await db
              .update(approvals)
              .set({
                status: "approved",
                decisionNote: `Auto-approved by ${manager.name}: ${reasoning}`,
                decidedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(approvals.id, approvalId));

            logger.info(
              {
                approvalId,
                managerId: manager.id,
                managerName: manager.name,
                reasoning,
              },
              "mastra-approval-bridge: tiered auto-approval by manager agent",
            );

            return {
              autoApproved: true,
              decidedByAgentId: manager.id,
              reasoning,
              escalatedToHuman: false,
            };
          }

          // Manager says ESCALATE or unclear → continue up the chain
          logger.info(
            { approvalId, managerId: manager.id, response: text.slice(0, 200) },
            "mastra-approval-bridge: manager escalated",
          );
        } catch (err) {
          logger.warn(
            { err, approvalId, managerId: manager.id },
            "mastra-approval-bridge: failed to consult manager, escalating",
          );
        }

        currentAgentId = manager.id;
      }

      // Reached top of chain without auto-approval → escalate to human
      return {
        autoApproved: false,
        decidedByAgentId: null,
        reasoning: null,
        escalatedToHuman: true,
      };
    },
  };
}
