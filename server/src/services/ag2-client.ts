/**
 * AG2 GroupChat HTTP client.
 * Calls the AG2 service at :8081 for multi-agent debates.
 */

const AG2_URL = process.env.AG2_URL ?? "http://localhost:8081";

export interface AG2ChatMessage {
  agent: string;
  content: string;
  round: number;
}

export interface AG2ChatResponse {
  messages: AG2ChatMessage[];
  conclusion: string;
  rounds: number;
  agents_involved: string[];
  consensus_reached: boolean;
  slack_thread_ts: string | null;
}

export interface AG2AgentInfo {
  mastra_agent: string;
  system_message_preview: string;
}

async function ag2Fetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${AG2_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AG2 API error: ${res.status} ${res.statusText} — ${body}`);
  }

  return res.json() as Promise<T>;
}

/** Start an AG2 group chat debate. */
export async function startDebate(
  topic: string,
  agents: string[],
  options?: {
    maxRounds?: number;
    speakerSelection?: string;
    context?: string;
    initiator?: string;
  },
): Promise<AG2ChatResponse> {
  return ag2Fetch<AG2ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({
      topic,
      agents,
      max_rounds: options?.maxRounds ?? 10,
      speaker_selection: options?.speakerSelection ?? "auto",
      context: options?.context,
      initiator: options?.initiator ?? agents[0],
    }),
  });
}

/** Start a debate and stream turns to Slack. */
export async function startDebateSlack(
  topic: string,
  channel: string,
  agents: string[],
  options?: {
    maxRounds?: number;
    speakerSelection?: string;
    context?: string;
    initiator?: string;
    threadTs?: string;
  },
): Promise<AG2ChatResponse> {
  return ag2Fetch<AG2ChatResponse>("/chat/slack", {
    method: "POST",
    body: JSON.stringify({
      topic,
      channel,
      agents,
      max_rounds: options?.maxRounds ?? 10,
      speaker_selection: options?.speakerSelection ?? "auto",
      context: options?.context,
      initiator: options?.initiator ?? agents[0],
      thread_ts: options?.threadTs,
    }),
  });
}

/** List available AG2 debate agents. */
export async function listAG2Agents(): Promise<Record<string, AG2AgentInfo>> {
  return ag2Fetch<Record<string, AG2AgentInfo>>("/agents");
}

/** Health check. */
export async function pingAG2(): Promise<boolean> {
  try {
    await ag2Fetch("/health");
    return true;
  } catch {
    return false;
  }
}
