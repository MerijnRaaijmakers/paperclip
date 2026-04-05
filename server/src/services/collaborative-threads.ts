/**
 * Multi-Agent Collaborative Threads.
 *
 * When an agent hits a decision point on an issue, it can spawn a
 * mini-debate with its delegates from the org chart. The thread runs
 * through AG2 and streams to Slack, producing a conclusion the agent
 * can act on.
 *
 * Flow:
 *   Agent working issue → calls requestCollaboration()
 *   → finds delegates from CHANNEL_CONFIG
 *   → starts AG2 debate with the question
 *   → streams turns to Slack thread
 *   → returns conclusion
 */

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { startDebateSlack, startDebate, type AG2ChatResponse } from "./ag2-client.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Agent → delegates mapping (mirrors CHANNEL_CONFIG from mastra)
// ---------------------------------------------------------------------------

const AGENT_DELEGATES: Record<string, string[]> = {
  "co-founder": ["planner", "researcher"],
  "engineering-lead": ["architect", "backend-architect", "debugger", "code-reviewer", "test-engineer"],
  "product-lead": ["planner", "researcher"],
  "marketing-lead": ["researcher", "technical-writer"],
  "frontend-developer": ["architect"],
  "secretary": ["devops-engineer", "security-engineer"],
  "lead-scout": ["researcher"],
};

// AG2 agent names (AG2 uses its own naming, not Mastra kebab-case)
const MASTRA_TO_AG2_AGENT: Record<string, string> = {
  "co-founder": "co-founder",
  "engineering-lead": "engineering-lead",
  "marketing-lead": "marketing-lead",
  "researcher": "researcher",
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface CollaborationRequest {
  /** Mastra agent ID (kebab-case) of the agent requesting collaboration */
  requestingAgentId: string;
  /** The question or decision point */
  question: string;
  /** Additional context (issue description, findings so far, etc.) */
  context?: string;
  /** Specific agents to include (overrides automatic delegate lookup) */
  includeAgents?: string[];
  /** Slack channel to post the thread to (optional — omit for no Slack) */
  slackChannel?: string;
  /** Max debate rounds */
  maxRounds?: number;
}

export interface CollaborationResult {
  conclusion: string;
  messages: AG2ChatResponse["messages"];
  rounds: number;
  consensusReached: boolean;
  participatingAgents: string[];
  slackThreadTs: string | null;
}

export function collaborativeThreadService(db: Db) {
  return {
    /**
     * Request collaboration from an agent's delegates on a decision point.
     * Spawns an AG2 debate with the relevant specialists.
     */
    requestCollaboration: async (
      request: CollaborationRequest,
    ): Promise<CollaborationResult> => {
      const { requestingAgentId, question, context, slackChannel, maxRounds } = request;

      // Determine participating agents
      let participatingAgents: string[];
      if (request.includeAgents?.length) {
        participatingAgents = request.includeAgents;
      } else {
        // Look up delegates from CHANNEL_CONFIG
        const delegates = AGENT_DELEGATES[requestingAgentId] ?? [];
        if (delegates.length === 0) {
          logger.warn({ requestingAgentId }, "collaborative-threads: no delegates found, using default panel");
          participatingAgents = ["co-founder", "engineering-lead", "researcher"];
        } else {
          // Include the requesting agent + its delegates
          participatingAgents = [requestingAgentId, ...delegates];
        }
      }

      // Map to AG2 agent names (AG2 has a subset of agents)
      // For agents not in AG2, use the requestor as initiator with context
      const ag2Agents = participatingAgents
        .filter((a) => MASTRA_TO_AG2_AGENT[a])
        .map((a) => MASTRA_TO_AG2_AGENT[a]!);

      // Ensure at least 2 agents for a debate
      if (ag2Agents.length < 2) {
        ag2Agents.push("co-founder", "engineering-lead");
        // Deduplicate
        const unique = [...new Set(ag2Agents)];
        ag2Agents.length = 0;
        ag2Agents.push(...unique);
      }

      const debateContext = context
        ? `${question}\n\n## Background\n${context}`
        : question;

      logger.info(
        { requestingAgentId, agents: ag2Agents, question: question.slice(0, 100) },
        "collaborative-threads: starting collaboration",
      );

      try {
        let result: AG2ChatResponse;

        if (slackChannel) {
          result = await startDebateSlack(
            `Decision point: ${question}`,
            slackChannel,
            ag2Agents,
            {
              maxRounds: maxRounds ?? 6,
              context: debateContext,
              initiator: MASTRA_TO_AG2_AGENT[requestingAgentId] ?? ag2Agents[0],
            },
          );
        } else {
          result = await startDebate(
            `Decision point: ${question}`,
            ag2Agents,
            {
              maxRounds: maxRounds ?? 6,
              context: debateContext,
              initiator: MASTRA_TO_AG2_AGENT[requestingAgentId] ?? ag2Agents[0],
            },
          );
        }

        logger.info(
          {
            requestingAgentId,
            rounds: result.rounds,
            consensus: result.consensus_reached,
          },
          "collaborative-threads: collaboration completed",
        );

        return {
          conclusion: result.conclusion,
          messages: result.messages,
          rounds: result.rounds,
          consensusReached: result.consensus_reached,
          participatingAgents: result.agents_involved,
          slackThreadTs: result.slack_thread_ts,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, requestingAgentId }, "collaborative-threads: debate failed");

        return {
          conclusion: `Collaboration failed: ${msg}`,
          messages: [],
          rounds: 0,
          consensusReached: false,
          participatingAgents: ag2Agents,
          slackThreadTs: null,
        };
      }
    },
  };
}
