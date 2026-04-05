import type { AdapterConfigFieldsProps } from "../types";

export function MastraConfigFields({ mode, values, set, config, eff, mark, models }: AdapterConfigFieldsProps) {
  if (mode === "create" && values && set) {
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Mastra Server URL</label>
          <input
            type="text"
            value={values.cwd || "http://localhost:4112"}
            onChange={(e) => set({ cwd: e.target.value })}
            placeholder="http://localhost:4112"
            className="w-full px-3 py-2 border rounded-md bg-background"
          />
          <p className="text-xs text-muted-foreground mt-1">URL of the Mastra HTTP server</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Agent ID</label>
          <select
            value={values.extraArgs || "coFounder"}
            onChange={(e) => set({ extraArgs: e.target.value })}
            className="w-full px-3 py-2 border rounded-md bg-background"
          >
            <option value="coFounder">Co-Founder (strategy, digest, sprints)</option>
            <option value="orchestrator">Orchestrator (coordinate teams)</option>
            <option value="planner">Planner (implementation plans)</option>
            <option value="executor">Executor (write code)</option>
            <option value="verifier">Verifier (test &amp; verify)</option>
            <option value="researcher">Researcher (research &amp; analysis)</option>
            <option value="critic">Critic (adversarial review)</option>
            <option value="engineeringLead">Engineering Lead (technical direction)</option>
            <option value="fullStackAgent">Full-Stack (general purpose)</option>
          </select>
          <p className="text-xs text-muted-foreground mt-1">Which Mastra agent handles this role</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Model Routing</label>
          <select
            value={values.model || "auto"}
            onChange={(e) => set({ model: e.target.value })}
            className="w-full px-3 py-2 border rounded-md bg-background"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">"Auto" switches between Claude and Codex based on rate limits</p>
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Mastra Server URL</label>
        <input
          type="text"
          value={eff("adapterConfig", "mastraUrl", (config.mastraUrl as string) || "http://localhost:4112")}
          onChange={(e) => mark("adapterConfig", "mastraUrl", e.target.value)}
          className="w-full px-3 py-2 border rounded-md bg-background"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Agent ID</label>
        <input
          type="text"
          value={eff("adapterConfig", "agentId", (config.agentId as string) || "coFounder")}
          onChange={(e) => mark("adapterConfig", "agentId", e.target.value)}
          className="w-full px-3 py-2 border rounded-md bg-background"
        />
      </div>
    </div>
  );
}
