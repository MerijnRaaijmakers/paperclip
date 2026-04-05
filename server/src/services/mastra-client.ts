/**
 * Mastra HTTP client for communicating with the Mastra agent server.
 * Used by: mastra-sync, heartbeat (execution), approval bridge, workflow triggers.
 */

const MASTRA_URL = process.env.MASTRA_URL ?? "http://localhost:4111";

export interface MastraAgentInfo {
  id: string;
  name: string;
  description?: string;
}

export interface MastraGenerateResponse {
  text: string;
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    toolCallId?: string;
  }>;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

async function mastraFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${MASTRA_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mastra API error: ${res.status} ${res.statusText} — ${body}`);
  }

  return res.json() as Promise<T>;
}

/** List all agents registered in the Mastra server. */
export async function listMastraAgents(): Promise<Record<string, MastraAgentInfo>> {
  // Mastra returns { [agentKey]: { id, name, ... } }
  return mastraFetch<Record<string, MastraAgentInfo>>("/api/agents");
}

/** Generate a response from a specific Mastra agent. */
export async function generateMastraAgent(
  agentId: string,
  messages: Array<{ role: string; content: string }>,
  options?: {
    threadId?: string;
    resourceId?: string;
    maxSteps?: number;
  },
): Promise<MastraGenerateResponse> {
  return mastraFetch<MastraGenerateResponse>(`/api/agents/${encodeURIComponent(agentId)}/generate`, {
    method: "POST",
    body: JSON.stringify({
      messages,
      ...options,
    }),
  });
}

/** Stream a response from a specific Mastra agent via SSE. */
export async function streamMastraAgent(
  agentId: string,
  messages: Array<{ role: string; content: string }>,
  onChunk: (chunk: string) => Promise<void>,
  options?: { threadId?: string; resourceId?: string; maxSteps?: number },
): Promise<MastraGenerateResponse> {
  const url = `${MASTRA_URL}/api/agents/${encodeURIComponent(agentId)}/stream`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...options }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mastra stream error: ${res.status} ${res.statusText} — ${body}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body for stream");

  const decoder = new TextDecoder();
  let fullText = "";
  let usage = { promptTokens: 0, completionTokens: 0 };
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;

      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "text-delta" || parsed.textDelta) {
            const text = parsed.textDelta ?? parsed.text ?? "";
            fullText += text;
            await onChunk(text);
          }
          if (parsed.type === "finish" || parsed.finishReason) {
            if (parsed.usage) {
              usage = {
                promptTokens: parsed.usage.promptTokens ?? 0,
                completionTokens: parsed.usage.completionTokens ?? 0,
              };
            }
          }
        } catch {
          // Non-JSON SSE line, pass as raw text
          await onChunk(data);
        }
      }
    }
  }

  return { text: fullText, finishReason: "stop", usage, toolCalls: [] };
}

/** Health check — verify Mastra server is reachable. */
export async function pingMastra(): Promise<boolean> {
  try {
    await mastraFetch("/api/agents");
    return true;
  } catch {
    return false;
  }
}

/** Resume a suspended Mastra workflow run. */
export async function resumeMastraWorkflow(
  workflowId: string,
  step: string,
  resumeData: Record<string, unknown>,
): Promise<{ runId?: string; status?: string }> {
  return mastraFetch(`/api/workflows/${encodeURIComponent(workflowId)}/resume`, {
    method: "POST",
    body: JSON.stringify({ step, resumeData }),
  });
}

/** List all workflows registered in Mastra. */
export async function listMastraWorkflows(): Promise<Record<string, { id: string; name?: string; description?: string }>> {
  return mastraFetch("/api/workflows");
}

/** Get detailed config for a specific Mastra agent. */
export async function getMastraAgentConfig(agentId: string): Promise<Record<string, unknown>> {
  return mastraFetch<Record<string, unknown>>(`/api/agents/${encodeURIComponent(agentId)}`);
}

/** Update a Mastra agent's runtime configuration. */
export async function updateMastraAgentConfig(
  agentId: string,
  config: {
    instructions?: string;
    model?: string;
    maxSteps?: number;
  },
): Promise<Record<string, unknown>> {
  return mastraFetch<Record<string, unknown>>(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: JSON.stringify(config),
  });
}

export function getMastraUrl(): string {
  return MASTRA_URL;
}
