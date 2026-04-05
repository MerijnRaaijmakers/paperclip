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
const AG2_URL = process.env.AG2_URL ?? "http://localhost:8081";

// Board participants for group debates (maps to AG2 AGENT_CONFIGS keys)
const BOARD_AGENTS = ["co-founder", "engineering-lead", "marketing-lead", "scope-guard"];

// Approval types that should go through board debate instead of 1-on-1 chain
const BOARD_DEBATE_TYPES = new Set(["hire_agent", "workflow_suspend"]);

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
      const reqConfig = requestingAgent?.adapterConfig as Record<string, unknown> | null;
      const mastraAgentId = (reqConfig?.mastraAgentId ?? reqConfig?.agentId) as string ?? "unknown";
      const reason = payload.suspendPayload?.reason as string ?? payload.suspendPayload?.message as string ?? "Workflow requires approval";

      // Choose approval path based on type
      const approvalType = (payload.suspendPayload?.type as string) ?? "workflow_suspend";
      const useBoard = BOARD_DEBATE_TYPES.has(approvalType);

      const tieredResult = useBoard
        ? await mastraApprovalBridgeService(db).attemptBoardApproval(
            created.id,
            requestedByAgentId,
            reason,
            approvalType,
            payload.suspendPayload?.context as string | undefined,
          )
        : await mastraApprovalBridgeService(db).attemptTieredApproval(
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

        const mgrConfig = manager.adapterConfig as Record<string, unknown>;
        const mastraAgentId = (mgrConfig?.mastraAgentId ?? mgrConfig?.agentId) as string | undefined;
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

    /**
     * Run a board debate via AG2 GroupChat for high-stakes approvals.
     * Team leads + scope-guard debate the request collectively.
     * Falls back to tiered (1-on-1) approval if AG2 is unreachable.
     */
    attemptBoardApproval: async (
      approvalId: string,
      requestingAgentId: string,
      reason: string,
      approvalType: string,
      context?: string,
    ): Promise<TieredApprovalResult> => {
      // Look up requesting agent name for the debate prompt
      const requester = await db
        .select({ name: agents.name, adapterConfig: agents.adapterConfig })
        .from(agents)
        .where(eq(agents.id, requestingAgentId))
        .then((rows) => rows[0] ?? null);

      const requesterName = requester?.name ?? "Unknown Agent";
      const reqCfg = requester?.adapterConfig as Record<string, unknown> | null;
      const mastraId = (reqCfg?.mastraAgentId ?? reqCfg?.agentId) as string ?? "unknown";

      const debatePrompt = `## Board Approval Request

**Type**: ${approvalType}
**Requested by**: ${requesterName} (${mastraId})
**Reason**: ${reason}
${context ? `\n**Additional context**:\n${context}` : ""}

## Your Task
Debate whether this should be approved. Each board member should weigh in from their perspective:
- Co-Founder: Business impact, budget, strategic fit
- Engineering Lead: Technical feasibility, team capacity, risk
- Marketing Lead: Market need, positioning, customer impact
- Scope Guard: Is this within our current priorities? Are we overextending?

After discussion, reach a decision. End with exactly one of:
- "BOARD DECISION: APPROVE — [reasoning]"
- "BOARD DECISION: ESCALATE — [reasoning why this needs human review]"`;

      try {
        const res = await fetch(`${AG2_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: debatePrompt,
            agents: BOARD_AGENTS,
            max_rounds: 6,
            speaker_selection: "auto",
            initiator: "co-founder",
            slack_channel: process.env.SLACK_OPS_CHANNEL ?? null,
          }),
          signal: AbortSignal.timeout(120_000), // 2 min max for the debate
        });

        if (!res.ok) {
          logger.warn(
            { approvalId, status: res.status },
            "mastra-approval-bridge: AG2 debate failed, falling back to tiered approval",
          );
          return mastraApprovalBridgeService(db).attemptTieredApproval(approvalId, requestingAgentId, reason);
        }

        const debate = (await res.json()) as {
          conclusion: string;
          consensus_reached: boolean;
          messages: Array<{ agent: string; content: string; round: number }>;
          rounds: number;
        };

        logger.info(
          {
            approvalId,
            rounds: debate.rounds,
            consensus: debate.consensus_reached,
            agents: BOARD_AGENTS,
          },
          "mastra-approval-bridge: board debate completed",
        );

        // Parse conclusion for BOARD DECISION
        const conclusion = debate.conclusion;
        const approveMatch = conclusion.match(/BOARD DECISION:\s*APPROVE\s*[—\-]\s*(.*)/is);
        const escalateMatch = conclusion.match(/BOARD DECISION:\s*ESCALATE\s*[—\-]\s*(.*)/is);

        if (approveMatch) {
          const reasoning = approveMatch[1]?.trim() || "Board consensus: approved";

          // Auto-approve in DB
          await db
            .update(approvals)
            .set({
              status: "approved",
              decisionNote: `Board approved (AG2 debate, ${debate.rounds} rounds): ${reasoning}`,
              decidedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(approvals.id, approvalId));

          // Post to Slack
          void postAutoApproval(mastraId, "Board (AG2)", reason, reasoning).catch(() => {});

          return {
            autoApproved: true,
            decidedByAgentId: null, // collective decision
            reasoning: `Board debate (${debate.rounds} rounds): ${reasoning}`,
            escalatedToHuman: false,
          };
        }

        if (escalateMatch) {
          const reasoning = escalateMatch[1]?.trim() || "Board could not reach consensus";

          logger.info(
            { approvalId, reasoning },
            "mastra-approval-bridge: board escalated to human",
          );

          return {
            autoApproved: false,
            decidedByAgentId: null,
            reasoning: `Board escalated: ${reasoning}`,
            escalatedToHuman: true,
          };
        }

        // No clear decision — treat as escalation
        logger.warn(
          { approvalId, conclusion: conclusion.slice(0, 200) },
          "mastra-approval-bridge: board debate had no clear decision, escalating",
        );
        return {
          autoApproved: false,
          decidedByAgentId: null,
          reasoning: `Board debate inconclusive after ${debate.rounds} rounds`,
          escalatedToHuman: true,
        };
      } catch (err) {
        // AG2 unreachable or timeout — fall back to tiered
        logger.warn(
          { err, approvalId },
          "mastra-approval-bridge: AG2 unreachable, falling back to tiered approval",
        );
        return mastraApprovalBridgeService(db).attemptTieredApproval(approvalId, requestingAgentId, reason);
      }
    },
  };
}
