/**
 * Mastra Local Adapter — Server-side execution
 *
 * Implements the Paperclip ServerAdapterModule interface.
 * Routes heartbeat invocations to the Mastra HTTP server.
 */

import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterSessionCodec,
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";

const DEFAULT_MASTRA_URL = "http://localhost:4112";
const CONNECT_TIMEOUT_MS = 5000;
const EXECUTE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per heartbeat

// ─── Config extraction ──────────────────────────────────────────

interface MastraAdapterConfig {
  mastraUrl: string;
  agentId: string;
  model: string;
  maxTurns: number;
}

function parseConfig(config: Record<string, unknown>): MastraAdapterConfig {
  return {
    mastraUrl: (config.mastraUrl as string) || (config.cwd as string) || DEFAULT_MASTRA_URL,
    agentId: (config.agentId as string) || (config.model as string) || "coFounder",
    model: (config.model as string) || "auto",
    maxTurns: (config.maxTurns as number) || 20,
  };
}

// ─── Prompt assembly ────────────────────────────────────────────

function buildPrompt(ctx: AdapterExecutionContext): string {
  const parts: string[] = [];

  // Agent identity from Paperclip
  parts.push(`You are ${ctx.agent.name} (agent ID: ${ctx.agent.id}) working for company ${ctx.agent.companyId}.`);

  // Task context from heartbeat
  if (ctx.context.prompt && typeof ctx.context.prompt === "string") {
    parts.push(ctx.context.prompt);
  }

  // Issue context if provided
  if (ctx.context.issueTitle) {
    parts.push(`\n## Current Task\nTitle: ${ctx.context.issueTitle}`);
    if (ctx.context.issueDescription) {
      parts.push(`Description: ${ctx.context.issueDescription}`);
    }
    if (ctx.context.issueComments && Array.isArray(ctx.context.issueComments)) {
      const comments = (ctx.context.issueComments as Array<{ author: string; body: string }>)
        .map((c) => `- ${c.author}: ${c.body}`)
        .join("\n");
      parts.push(`\nComments:\n${comments}`);
    }
  }

  // Company context
  if (ctx.context.companyGoal) {
    parts.push(`\n## Company Goal\n${ctx.context.companyGoal}`);
  }

  // Agent instructions (from Paperclip persona config)
  if (ctx.context.agentInstructions) {
    parts.push(`\n## Your Instructions\n${ctx.context.agentInstructions}`);
  }

  return parts.join("\n\n");
}

// ─── Execute ────────────────────────────────────────────────────

export async function execute(
  ctx: AdapterExecutionContext,
): Promise<AdapterExecutionResult> {
  const config = parseConfig(ctx.config);
  const prompt = buildPrompt(ctx);
  const startTime = Date.now();

  await ctx.onLog("stdout", `[mastra] Routing to agent: ${config.agentId} at ${config.mastraUrl}\n`);

  if (ctx.onMeta) {
    await ctx.onMeta({
      adapterType: "mastra_local",
      command: `POST ${config.mastraUrl}/agent/${config.agentId}/generate`,
      prompt,
      promptMetrics: { promptLength: prompt.length },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXECUTE_TIMEOUT_MS);

    const response = await fetch(`${config.mastraUrl}/agent/${config.agentId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      await ctx.onLog("stderr", `[mastra] Agent returned ${response.status}: ${errorText}\n`);

      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: `Mastra agent ${config.agentId} returned ${response.status}: ${errorText}`,
        errorCode: "MASTRA_AGENT_ERROR",
        provider: "mastra",
        model: config.model,
        billingType: "subscription",
      };
    }

    const result = (await response.json()) as {
      agentId: string;
      text: string;
      usage?: { inputTokens: number; outputTokens: number };
      providerMetadata?: Record<string, unknown>;
    };

    const durationMs = Date.now() - startTime;
    await ctx.onLog("stdout", `[mastra] Agent completed in ${(durationMs / 1000).toFixed(1)}s\n`);
    await ctx.onLog("stdout", result.text + "\n");

    // Extract usage from response
    const usage = result.usage
      ? {
          inputTokens: result.usage.inputTokens || 0,
          outputTokens: result.usage.outputTokens || 0,
        }
      : undefined;

    // Extract cost from provider metadata if available
    const metadata = result.providerMetadata as Record<string, Record<string, unknown>> | undefined;
    const costUsd = (metadata?.["claude-code"]?.costUsd as number) ??
      (metadata?.codex?.costUsd as number) ??
      null;

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage,
      provider: "mastra",
      model: config.model,
      billingType: "subscription",
      costUsd,
      summary: result.text.slice(0, 500),
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const message = error instanceof Error ? error.message : String(error);

    await ctx.onLog("stderr", `[mastra] ${isTimeout ? "Timed out" : "Failed"} after ${(durationMs / 1000).toFixed(1)}s: ${message}\n`);

    return {
      exitCode: isTimeout ? 124 : 1,
      signal: null,
      timedOut: isTimeout,
      errorMessage: message,
      errorCode: isTimeout ? "MASTRA_TIMEOUT" : "MASTRA_CONNECTION_ERROR",
      provider: "mastra",
      model: config.model,
      billingType: "subscription",
    };
  }
}

// ─── Environment test ───────────────────────────────────────────

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const config = parseConfig(ctx.config);
  const checks: AdapterEnvironmentTestResult["checks"] = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    const response = await fetch(`${config.mastraUrl}/status`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      const status = (await response.json()) as {
        status: string;
        agents: number;
        workflows: number;
      };

      checks.push({
        code: "mastra_reachable",
        level: "info",
        message: `Mastra server is running at ${config.mastraUrl}`,
        detail: `${status.agents} agents, ${status.workflows} workflows registered`,
      });
    } else {
      checks.push({
        code: "mastra_error",
        level: "error",
        message: `Mastra server returned ${response.status}`,
        hint: `Check if the Mastra server is running: bun src/mastra/server.ts`,
      });
    }
  } catch {
    checks.push({
      code: "mastra_unreachable",
      level: "error",
      message: `Cannot reach Mastra server at ${config.mastraUrl}`,
      hint: `Start the Mastra server: cd mastra && bun src/mastra/server.ts`,
    });
  }

  const hasErrors = checks.some((c) => c.level === "error");

  return {
    adapterType: "mastra_local",
    status: hasErrors ? "fail" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}

// ─── Session codec ──────────────────────────────────────────────

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== "object") return null;
    return raw as Record<string, unknown>;
  },
  serialize(params: Record<string, unknown> | null): Record<string, unknown> | null {
    return params;
  },
  getDisplayId(params: Record<string, unknown> | null): string | null {
    if (!params) return null;
    return (params.threadId as string) || (params.agentId as string) || null;
  },
};
