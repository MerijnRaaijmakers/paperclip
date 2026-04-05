/**
 * Mastra Local Adapter for Paperclip
 *
 * Bridges Paperclip heartbeats to Mastra agents. Instead of spawning a CLI subprocess,
 * this adapter calls the Mastra HTTP server which routes to the appropriate agent
 * with full memory, MCP tools, and workflow support.
 */

import type { AdapterModel } from "@paperclipai/adapter-utils";

export const ADAPTER_TYPE = "mastra_local";

export const models: AdapterModel[] = [
  { id: "opus", label: "Claude Opus (via Mastra)" },
  { id: "sonnet", label: "Claude Sonnet (via Mastra)" },
  { id: "gpt-5.4", label: "GPT-5.4 (via Codex)" },
  { id: "auto", label: "Auto (rate-limit aware routing)" },
];

export const agentConfigurationDoc = `
## Mastra Local Adapter

This adapter routes Paperclip heartbeats to the ONE62 Mastra agent system.
Instead of spawning a CLI subprocess, it calls the Mastra HTTP server which
provides agents with persistent memory, MCP tools (Agent OS, Slack, Plane),
typed workflows, and rate-limit-aware model routing.

### Configuration

- **Mastra URL**: The Mastra server endpoint (default: http://localhost:4111)
- **Agent ID**: Which Mastra agent to route to (e.g. "co-founder", "orchestrator", "executor")
- **Model**: Which model to use — "auto" for rate-limit-aware routing

### Available Agents

| Agent | Best For |
|-------|---------|
| coFounder | Business strategy, morning digest, sprint planning |
| orchestrator | Coordinating multi-agent work |
| planner | Creating implementation plans |
| executor | Writing code, implementing features |
| verifier | Testing and verification |
| researcher | Research, competitive analysis |
| critic | Adversarial review, finding flaws |
| engineeringLead | Technical direction, code review |

### How It Works

1. Paperclip fires a heartbeat with task context
2. This adapter formats the context into a prompt
3. Calls Mastra's /agent/:id/generate endpoint
4. Mastra agent runs with full memory + MCP tools
5. Result flows back to Paperclip with token usage
`;
