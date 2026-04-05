/**
 * Slack Activity Feed.
 *
 * Posts all agent activity to the appropriate Slack channels.
 * Maps agents → channels via CHANNEL_CONFIG hierarchy.
 * Each agent posts with their own username + emoji identity.
 */

import { logger } from "../middleware/logger.js";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "";
const SLACK_API = "https://slack.com/api";

// ---------------------------------------------------------------------------
// Agent Slack identity — maps Mastra agent IDs to Slack display
// ---------------------------------------------------------------------------

const AGENT_SLACK_IDENTITY: Record<string, { username: string; icon_emoji: string }> = {
  "co-founder":             { username: "Co-Founder",         icon_emoji: ":star:" },
  "secretary":              { username: "Secretary",           icon_emoji: ":clipboard:" },
  "engineering-lead":       { username: "Engineering Lead",    icon_emoji: ":wrench:" },
  "engineering-manager":    { username: "Engineering Manager", icon_emoji: ":gear:" },
  "orchestrator":           { username: "Orchestrator",        icon_emoji: ":zap:" },
  "planner":                { username: "Planner",             icon_emoji: ":memo:" },
  "researcher":             { username: "Researcher",          icon_emoji: ":microscope:" },
  "executor":               { username: "Executor",            icon_emoji: ":computer:" },
  "critic":                 { username: "Critic",              icon_emoji: ":eyes:" },
  "verifier":               { username: "Verifier",            icon_emoji: ":white_check_mark:" },
  "debugger":               { username: "Debugger",            icon_emoji: ":mag:" },
  "code-reviewer":          { username: "Code Reviewer",       icon_emoji: ":eyes:" },
  "qa-engineer":            { username: "QA Engineer",         icon_emoji: ":shield:" },
  "architect":              { username: "Architect",           icon_emoji: ":brain:" },
  "backend-architect":      { username: "Backend Architect",   icon_emoji: ":cpu:" },
  "frontend-developer":     { username: "Frontend Dev",        icon_emoji: ":art:" },
  "security-engineer":      { username: "Security Engineer",   icon_emoji: ":lock:" },
  "devops-engineer":        { username: "DevOps Engineer",     icon_emoji: ":hammer_and_wrench:" },
  "database-architect":     { username: "DB Architect",        icon_emoji: ":floppy_disk:" },
  "test-engineer":          { username: "Test Engineer",       icon_emoji: ":test_tube:" },
  "technical-writer":       { username: "Technical Writer",    icon_emoji: ":pencil:" },
  "refactoring-specialist": { username: "Refactoring",         icon_emoji: ":recycle:" },
  "full-stack":             { username: "Full Stack",          icon_emoji: ":rocket:" },
  "product-lead":           { username: "Product Lead",        icon_emoji: ":dart:" },
  "marketing-lead":         { username: "Marketing Lead",      icon_emoji: ":loudspeaker:" },
  "lead-scout":             { username: "Lead Scout",          icon_emoji: ":mag:" },
};

// ---------------------------------------------------------------------------
// Agent → Slack channel routing
// ---------------------------------------------------------------------------

/** Maps Mastra agent IDs to their primary Slack channel. */
const AGENT_CHANNEL_MAP: Record<string, string> = {
  "co-founder": "general",
  "secretary": "ops-daily",
  "engineering-lead": "team-engineering",
  "engineering-manager": "team-engineering",
  "orchestrator": "team-engineering",
  "executor": "team-engineering",
  "architect": "team-engineering",
  "backend-architect": "team-engineering",
  "debugger": "team-engineering",
  "code-reviewer": "team-engineering",
  "test-engineer": "team-engineering",
  "qa-engineer": "team-engineering",
  "verifier": "team-engineering",
  "full-stack": "team-engineering",
  "refactoring-specialist": "team-engineering",
  "database-architect": "team-engineering",
  "frontend-developer": "team-design",
  "product-lead": "team-product",
  "planner": "team-product",
  "marketing-lead": "team-marketing",
  "technical-writer": "team-marketing",
  "researcher": "team-product",
  "security-engineer": "ops-alerts",
  "devops-engineer": "ops-alerts",
  "lead-scout": "leads",
  "critic": "general",
};

// ---------------------------------------------------------------------------
// Slack API helpers
// ---------------------------------------------------------------------------

async function slackPost(method: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!SLACK_BOT_TOKEN) {
    logger.warn("slack-activity: SLACK_BOT_TOKEN not set, skipping post");
    return null;
  }

  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!data.ok) {
      logger.warn({ method, error: data.error }, "slack-activity: Slack API error");
    }
    return data;
  } catch (err) {
    logger.error({ err, method }, "slack-activity: failed to post to Slack");
    return null;
  }
}

function getIdentity(mastraAgentId: string) {
  return AGENT_SLACK_IDENTITY[mastraAgentId] ?? { username: mastraAgentId, icon_emoji: ":robot_face:" };
}

function getChannel(mastraAgentId: string): string {
  return AGENT_CHANNEL_MAP[mastraAgentId] ?? "general";
}

// ---------------------------------------------------------------------------
// Activity posting functions
// ---------------------------------------------------------------------------

export async function postTaskPickup(
  mastraAgentId: string,
  issueIdentifier: string,
  issueTitle: string,
): Promise<string | null> {
  const identity = getIdentity(mastraAgentId);
  const channel = getChannel(mastraAgentId);
  const result = await slackPost("chat.postMessage", {
    channel,
    text: `${identity.icon_emoji} *${identity.username}* picked up ${issueIdentifier}: ${issueTitle}`,
    username: identity.username,
    icon_emoji: identity.icon_emoji,
  });
  return (result?.ts as string) ?? null;
}

export async function postDelegation(
  mastraAgentId: string,
  delegateAgentId: string,
  reason: string,
  threadTs: string,
): Promise<void> {
  const identity = getIdentity(mastraAgentId);
  const delegateIdentity = getIdentity(delegateAgentId);
  const channel = getChannel(mastraAgentId);
  await slackPost("chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text: `${identity.icon_emoji} *${identity.username}* delegated to *${delegateIdentity.username}*: "${reason}"`,
    username: identity.username,
    icon_emoji: identity.icon_emoji,
  });
}

export async function postCompletion(
  mastraAgentId: string,
  issueIdentifier: string,
  summary: string,
  threadTs?: string,
): Promise<void> {
  const identity = getIdentity(mastraAgentId);
  const channel = getChannel(mastraAgentId);
  await slackPost("chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text: `:white_check_mark: *${identity.username}* completed ${issueIdentifier}: ${summary.slice(0, 300)}`,
    username: identity.username,
    icon_emoji: identity.icon_emoji,
  });
}

export async function postError(
  mastraAgentId: string,
  issueIdentifier: string,
  errorMessage: string,
): Promise<void> {
  const identity = getIdentity(mastraAgentId);
  await slackPost("chat.postMessage", {
    channel: "ops-alerts",
    text: `:warning: *${identity.username}* failed on ${issueIdentifier}: ${errorMessage.slice(0, 500)}`,
    username: identity.username,
    icon_emoji: identity.icon_emoji,
  });
}

export async function postApprovalRequest(
  mastraAgentId: string,
  approvalId: string,
  reason: string,
  paperclipBaseUrl: string,
): Promise<void> {
  const identity = getIdentity(mastraAgentId);
  const channel = getChannel(mastraAgentId);
  await slackPost("chat.postMessage", {
    channel,
    text: `:raised_hand: *${identity.username}* requests approval: ${reason}`,
    username: identity.username,
    icon_emoji: identity.icon_emoji,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:raised_hand: *${identity.username}* requests approval:\n>${reason}`,
        },
      },
      {
        type: "actions",
        block_id: `approval_${approvalId}`,
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve" },
            style: "primary",
            action_id: "approve_workflow",
            value: approvalId,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Reject" },
            style: "danger",
            action_id: "reject_workflow",
            value: approvalId,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "View in Paperclip" },
            url: `${paperclipBaseUrl}/approvals/${approvalId}`,
            action_id: "view_approval",
          },
        ],
      },
    ],
  });
}

export async function postAutoApproval(
  mastraAgentId: string,
  managerName: string,
  reason: string,
  reasoning: string,
): Promise<void> {
  const identity = getIdentity(mastraAgentId);
  const channel = getChannel(mastraAgentId);
  await slackPost("chat.postMessage", {
    channel,
    text: `:ballot_box_with_check: *${managerName}* auto-approved request from *${identity.username}*: ${reason}\n_Reasoning: ${reasoning.slice(0, 200)}_`,
    username: managerName,
    icon_emoji: ":white_check_mark:",
  });
}

export async function postWorkflowProgress(
  mastraAgentId: string,
  stepNumber: number,
  totalSteps: number,
  stepDescription: string,
  status: "running" | "complete" | "suspended",
  threadTs?: string,
): Promise<string | null> {
  const identity = getIdentity(mastraAgentId);
  const channel = getChannel(mastraAgentId);
  const icon = status === "complete" ? ":white_check_mark:" : status === "suspended" ? ":hourglass:" : ":hourglass_flowing_sand:";
  const result = await slackPost("chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text: `${icon} Step ${stepNumber}/${totalSteps}: ${stepDescription}`,
    username: identity.username,
    icon_emoji: identity.icon_emoji,
  });
  return (result?.ts as string) ?? null;
}
