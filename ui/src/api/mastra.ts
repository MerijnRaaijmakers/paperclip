import { api } from "./client";

export interface MastraWorkflow {
  id: string;
  name?: string;
  description?: string;
}

export interface MastraWorkflowRunStatus {
  runId: string;
  status: string;
  steps?: Record<string, Record<string, unknown>> | null;
  result?: Record<string, unknown> | string | null;
}

export interface AG2DebateMessage {
  agent: string;
  content: string;
  round: number;
}

export interface AG2DebateResult {
  messages: AG2DebateMessage[];
  conclusion: string;
  rounds: number;
  agents_involved: string[];
  consensus_reached: boolean;
  slack_thread_ts: string | null;
}

export const mastraApi = {
  // Workflows
  listWorkflows: () => api.get<Record<string, MastraWorkflow>>("/mastra/workflows"),
  startWorkflow: (workflowId: string, inputData?: Record<string, unknown>) =>
    api.post<MastraWorkflowRunStatus>(`/mastra/workflows/${workflowId}/run`, { inputData }),
  getWorkflowRun: (workflowId: string, runId: string) =>
    api.get<MastraWorkflowRunStatus>(`/mastra/workflows/${workflowId}/runs/${runId}`),

  // Config sync
  getAgentMastraConfig: (agentId: string) =>
    api.get<Record<string, unknown>>(`/agents/${agentId}/mastra-config`),
  updateAgentMastraConfig: (agentId: string, config: { instructions?: string; model?: string; maxSteps?: number }) =>
    api.post<Record<string, unknown>>(`/agents/${agentId}/mastra-config`, config),

  // AG2 Debates
  listDebateAgents: () => api.get<Record<string, { mastra_agent: string; system_message_preview: string }>>("/ag2/agents"),
  startDebate: (companyId: string, body: {
    topic: string;
    agents: string[];
    maxRounds?: number;
    speakerSelection?: string;
    context?: string;
    initiator?: string;
    slackChannel?: string;
  }) => api.post<AG2DebateResult>(`/companies/${companyId}/debates`, body),
};
