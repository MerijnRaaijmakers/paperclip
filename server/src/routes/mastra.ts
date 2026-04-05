/**
 * Mastra + AG2 routes.
 *
 * Exposes Mastra workflows and AG2 debates via Paperclip's API.
 * These proxy to Mastra (:4111) and AG2 (:8081) HTTP APIs.
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { listMastraWorkflows } from "../services/mastra-client.js";
import { startDebate, startDebateSlack, listAG2Agents } from "../services/ag2-client.js";
import { collaborativeThreadService } from "../services/collaborative-threads.js";
import { assertCompanyAccess } from "./authz.js";
import { logger } from "../middleware/logger.js";

export function mastraRoutes(db: Db) {
  const router = Router();

  // ── Mastra Workflows ──────────────────────────────────────────────

  /** List all registered Mastra workflows. */
  router.get("/mastra/workflows", async (_req, res) => {
    try {
      const workflows = await listMastraWorkflows();
      res.json(workflows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "mastra-routes: failed to list workflows");
      res.status(502).json({ error: `Failed to fetch workflows from Mastra: ${msg}` });
    }
  });

  /** Start a Mastra workflow run (proxy to Mastra API). */
  router.post("/mastra/workflows/:workflowId/run", async (req, res) => {
    const { workflowId } = req.params;
    const { inputData } = req.body as { inputData?: Record<string, unknown> };

    try {
      const MASTRA_URL = process.env.MASTRA_URL ?? "http://localhost:4111";

      // Create run
      const createRes = await fetch(`${MASTRA_URL}/api/workflows/${encodeURIComponent(workflowId)}/createRun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!createRes.ok) throw new Error(`createRun failed: ${createRes.status}`);
      const { runId } = await createRes.json() as { runId: string };

      // Start the run
      const startRes = await fetch(`${MASTRA_URL}/api/workflows/${encodeURIComponent(workflowId)}/runs/${runId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputData: inputData ?? {} }),
      });
      if (!startRes.ok) throw new Error(`start failed: ${startRes.status}`);
      const result = await startRes.json();

      res.json({ runId, ...result as Record<string, unknown> });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, workflowId }, "mastra-routes: failed to start workflow");
      res.status(502).json({ error: msg });
    }
  });

  /** Get a workflow run's status. */
  router.get("/mastra/workflows/:workflowId/runs/:runId", async (req, res) => {
    const { workflowId, runId } = req.params;
    try {
      const MASTRA_URL = process.env.MASTRA_URL ?? "http://localhost:4111";
      const result = await fetch(`${MASTRA_URL}/api/workflows/${encodeURIComponent(workflowId)}/runs/${runId}`);
      if (!result.ok) throw new Error(`fetch run failed: ${result.status}`);
      res.json(await result.json());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: msg });
    }
  });

  // ── AG2 Debates ───────────────────────────────────────────────────

  /** List available AG2 debate agents. */
  router.get("/ag2/agents", async (_req, res) => {
    try {
      const agents = await listAG2Agents();
      res.json(agents);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `AG2 not reachable: ${msg}` });
    }
  });

  /** Start an AG2 debate. */
  router.post("/companies/:companyId/debates", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const {
      topic,
      agents,
      maxRounds,
      speakerSelection,
      context,
      initiator,
      slackChannel,
    } = req.body as {
      topic: string;
      agents: string[];
      maxRounds?: number;
      speakerSelection?: string;
      context?: string;
      initiator?: string;
      slackChannel?: string;
    };

    if (!topic || !agents?.length) {
      res.status(400).json({ error: "topic and agents are required" });
      return;
    }

    try {
      const result = slackChannel
        ? await startDebateSlack(topic, slackChannel, agents, { maxRounds, speakerSelection, context, initiator })
        : await startDebate(topic, agents, { maxRounds, speakerSelection, context, initiator });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, topic }, "mastra-routes: failed to start debate");
      res.status(502).json({ error: msg });
    }
  });

  // ── Collaborative Threads ──────────────────────────────────────────

  /** Spawn a multi-agent collaborative thread on a decision point. */
  router.post("/companies/:companyId/collaborate", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const {
      requestingAgentId,
      question,
      context,
      includeAgents,
      slackChannel,
      maxRounds,
    } = req.body as {
      requestingAgentId: string;
      question: string;
      context?: string;
      includeAgents?: string[];
      slackChannel?: string;
      maxRounds?: number;
    };

    if (!requestingAgentId || !question) {
      res.status(400).json({ error: "requestingAgentId and question are required" });
      return;
    }

    try {
      const collab = collaborativeThreadService(db);
      const result = await collab.requestCollaboration({
        requestingAgentId,
        question,
        context,
        includeAgents,
        slackChannel,
        maxRounds,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, requestingAgentId }, "mastra-routes: collaboration failed");
      res.status(502).json({ error: msg });
    }
  });

  return router;
}
