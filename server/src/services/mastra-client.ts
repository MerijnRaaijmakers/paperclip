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

export function getMastraUrl(): string {
  return MASTRA_URL;
}
