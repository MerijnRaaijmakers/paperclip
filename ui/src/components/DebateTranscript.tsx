/**
 * AG2 Debate Transcript Viewer.
 * Renders multi-agent debate turns with agent identity, round numbers, and conclusion.
 */

import { cn } from "../lib/utils";
import type { AG2DebateMessage, AG2DebateResult } from "../api/mastra";

const AGENT_COLORS: Record<string, string> = {
  "co-founder": "text-amber-400",
  "engineering-lead": "text-blue-400",
  "marketing-lead": "text-pink-400",
  "scope-guard": "text-green-400",
  "devil-advocate": "text-red-400",
  "researcher": "text-purple-400",
  "product-lead": "text-cyan-400",
};

const AGENT_EMOJI: Record<string, string> = {
  "co-founder": "⭐",
  "engineering-lead": "🔧",
  "marketing-lead": "📢",
  "scope-guard": "🛡️",
  "devil-advocate": "😈",
  "researcher": "🔬",
  "product-lead": "🎯",
};

function agentColor(name: string): string {
  return AGENT_COLORS[name] ?? "text-foreground";
}

function agentEmoji(name: string): string {
  return AGENT_EMOJI[name] ?? "🤖";
}

export function DebateTranscript({ debate }: { debate: AG2DebateResult }) {
  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {debate.rounds} rounds · {debate.agents_involved.length} agents
          </span>
        </div>
        <span
          className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-full",
            debate.consensus_reached
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {debate.consensus_reached ? "Consensus reached" : "No consensus"}
        </span>
      </div>

      {/* Turns */}
      <div className="divide-y divide-border/50">
        {debate.messages.map((msg, i) => (
          <div key={i} className="px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">{agentEmoji(msg.agent)}</span>
              <span className={cn("text-xs font-semibold", agentColor(msg.agent))}>
                {msg.agent}
              </span>
              <span className="text-[10px] text-muted-foreground/50">
                Round {msg.round + 1}
              </span>
            </div>
            <div className="text-sm text-foreground/90 whitespace-pre-wrap pl-6">
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Conclusion */}
      {debate.conclusion && (
        <div className="border-t border-border px-3 py-3 bg-accent/20">
          <div className="text-xs font-semibold text-muted-foreground mb-1">Conclusion</div>
          <div className="text-sm text-foreground whitespace-pre-wrap">
            {debate.conclusion}
          </div>
        </div>
      )}
    </div>
  );
}
