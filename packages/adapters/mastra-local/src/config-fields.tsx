/**
 * Mastra Local Adapter — UI config fields for Paperclip agent creation form
 */

import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export function getDefaultValues(): Partial<CreateConfigValues> {
  return {
    adapterType: "mastra_local",
    cwd: "http://localhost:4111",
    model: "auto",
    promptTemplate: "",
    heartbeatEnabled: true,
    intervalSec: 30,
    maxTurnsPerRun: 20,
    dangerouslySkipPermissions: true,
  };
}

export function getConfigFields() {
  return [
    {
      name: "cwd",
      label: "Mastra Server URL",
      type: "text" as const,
      placeholder: "http://localhost:4111",
      description: "URL of the Mastra HTTP server",
    },
    {
      name: "extraArgs",
      label: "Mastra Agent ID",
      type: "text" as const,
      placeholder: "co-founder",
      description: "Which Mastra agent to route heartbeats to (e.g. co-founder, orchestrator, executor)",
    },
  ];
}
