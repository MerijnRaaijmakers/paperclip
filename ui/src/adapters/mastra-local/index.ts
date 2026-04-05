import type { UIAdapterModule, AdapterConfigFieldsProps } from "../types";
import type { TranscriptEntry, CreateConfigValues } from "@paperclipai/adapter-utils";
import { MastraConfigFields } from "./config-fields";

function parseStdoutLine(line: string, ts: string): TranscriptEntry[] {
  // Mastra adapter logs are plain text prefixed with [mastra]
  if (line.startsWith("[mastra]")) {
    return [{ kind: "system", ts, text: line }];
  }
  return [{ kind: "assistant", ts, text: line }];
}

function buildAdapterConfig(values: CreateConfigValues): Record<string, unknown> {
  return {
    mastraUrl: values.cwd || "http://localhost:4112",
    agentId: values.extraArgs || "coFounder",
    model: values.model || "auto",
    maxTurns: values.maxTurnsPerRun || 20,
  };
}

export const mastraLocalUIAdapter: UIAdapterModule = {
  type: "mastra_local",
  label: "Mastra (ONE62)",
  parseStdoutLine,
  ConfigFields: MastraConfigFields as any,
  buildAdapterConfig,
};
