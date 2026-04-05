/**
 * Slack Interactive Messages handler.
 *
 * Handles button clicks from Slack approval messages (approve/reject).
 * Slack sends a POST with a URL-encoded `payload` field containing the action.
 *
 * Configure this URL in your Slack app's "Interactivity & Shortcuts" settings:
 *   Request URL: https://your-paperclip-url/api/slack/interactions
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { approvalService } from "../services/approvals.js";
import { logger } from "../middleware/logger.js";

export function slackInteractionRoutes(db: Db) {
  const router = Router();
  const approvalsSvc = approvalService(db);

  // Slack sends interaction payloads as application/x-www-form-urlencoded
  // with a `payload` field containing JSON
  router.post("/slack/interactions", async (req, res) => {
    try {
      const rawPayload = req.body?.payload;
      if (!rawPayload || typeof rawPayload !== "string") {
        res.status(400).json({ error: "Missing payload" });
        return;
      }

      const payload = JSON.parse(rawPayload) as {
        type: string;
        user: { id: string; username: string; name: string };
        actions: Array<{
          action_id: string;
          value: string;
          block_id: string;
        }>;
        response_url: string;
      };

      if (payload.type !== "block_actions") {
        res.json({ ok: true });
        return;
      }

      for (const action of payload.actions) {
        const approvalId = action.value;
        const slackUserId = payload.user.id;
        const slackUsername = payload.user.name || payload.user.username;

        if (action.action_id === "approve_workflow") {
          await approvalsSvc.approve(approvalId, `slack:${slackUserId}`, `Approved via Slack by ${slackUsername}`);

          // Update the Slack message to show it was approved
          if (payload.response_url) {
            await fetch(payload.response_url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                replace_original: true,
                text: `:white_check_mark: *Approved* by ${slackUsername}`,
              }),
            }).catch(() => {});
          }

          logger.info({ approvalId, slackUserId }, "slack-interactions: approval approved via Slack");
        } else if (action.action_id === "reject_workflow") {
          await approvalsSvc.reject(approvalId, `slack:${slackUserId}`, `Rejected via Slack by ${slackUsername}`);

          if (payload.response_url) {
            await fetch(payload.response_url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                replace_original: true,
                text: `:x: *Rejected* by ${slackUsername}`,
              }),
            }).catch(() => {});
          }

          logger.info({ approvalId, slackUserId }, "slack-interactions: approval rejected via Slack");
        }
      }

      // Slack expects a 200 within 3 seconds
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "slack-interactions: error handling interaction");
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
