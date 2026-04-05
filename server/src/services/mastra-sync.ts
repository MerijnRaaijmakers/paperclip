/**
 * Mastra Agent Sync Service.
 *
 * Reads agent registry from the Mastra HTTP API + hardcoded CHANNEL_CONFIG
 * hierarchy, and upserts into Paperclip's agents table with correct reportsTo
 * relationships so the org chart renders the full Mastra team.
 */

import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { listMastraAgents, type MastraAgentInfo } from "./mastra-client.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// CHANNEL_CONFIG hierarchy — mirrors mastra/src/mastra/config/channel-agents.ts
// This is the source of truth for reportsTo relationships.
// ---------------------------------------------------------------------------

interface ChannelConfig {
  primary: string;
  canDelegate: string[];
  ambientWatchers: string[];
}

// Keys use kebab-case to match Mastra API agent IDs
const CHANNEL_CONFIG: Record<string, ChannelConfig> = {
  general: {
    primary: "co-founder",
    canDelegate: ["planner", "researcher"],
    ambientWatchers: [],
  },
  "ops-daily": {
    primary: "secretary",
    canDelegate: ["co-founder"],
    ambientWatchers: ["co-founder"],
  },
  "team-engineering": {
    primary: "engineering-lead",
    canDelegate: ["architect", "backend-architect", "debugger", "code-reviewer", "test-engineer"],
    ambientWatchers: ["co-founder"],
  },
  "team-product": {
    primary: "product-lead",
    canDelegate: ["planner", "researcher"],
    ambientWatchers: ["co-founder"],
  },
  "team-marketing": {
    primary: "marketing-lead",
    canDelegate: ["researcher", "technical-writer"],
    ambientWatchers: ["co-founder"],
  },
  "team-design": {
    primary: "frontend-developer",
    canDelegate: ["architect"],
    ambientWatchers: ["co-founder"],
  },
  "ops-alerts": {
    primary: "secretary",
    canDelegate: ["devops-engineer", "security-engineer"],
    ambientWatchers: ["co-founder"],
  },
  leads: {
    primary: "lead-scout",
    canDelegate: ["researcher"],
    ambientWatchers: ["co-founder"],
  },
};

// ---------------------------------------------------------------------------
// Agent metadata — display names, roles, icons, titles
// ---------------------------------------------------------------------------

interface AgentMeta {
  displayName: string;
  /** Paperclip AgentRole — must be one of: ceo, cto, cmo, cfo, engineer, designer, pm, qa, devops, researcher, general */
  role: string;
  title: string;
  icon: string;
}

// Keys use kebab-case to match Mastra API response IDs (e.g., "co-founder", "engineering-lead")
const AGENT_META: Record<string, AgentMeta> = {
  "co-founder":             { displayName: "Co-Founder",             role: "ceo",        title: "Chief of Staff",                icon: "star" },
  "secretary":              { displayName: "Secretary",              role: "general",    title: "Operations Assistant",          icon: "bot" },
  "engineering-manager":    { displayName: "Engineering Manager",    role: "cto",        title: "Engineering Management",        icon: "cpu" },
  "engineering-lead":       { displayName: "Engineering Lead",       role: "engineer",   title: "Engineering Team Lead",         icon: "wrench" },
  "product-lead":           { displayName: "Product Lead",           role: "pm",         title: "Product Team Lead",             icon: "lightbulb" },
  "marketing-lead":         { displayName: "Marketing Lead",         role: "cmo",        title: "Marketing Team Lead",           icon: "rocket" },
  "orchestrator":           { displayName: "Orchestrator",           role: "engineer",   title: "Task Orchestration",            icon: "zap" },
  "planner":                { displayName: "Planner",                role: "pm",         title: "Planning & Strategy",           icon: "lightbulb" },
  "executor":               { displayName: "Executor",               role: "engineer",   title: "Code Execution",                icon: "terminal" },
  "critic":                 { displayName: "Critic",                 role: "qa",         title: "Quality Critic",                icon: "eye" },
  "verifier":               { displayName: "Verifier",               role: "qa",         title: "Verification Specialist",       icon: "shield" },
  "debugger":               { displayName: "Debugger",               role: "engineer",   title: "Bug Investigation",             icon: "search" },
  "code-reviewer":          { displayName: "Code Reviewer",          role: "engineer",   title: "Code Review",                   icon: "eye" },
  "qa-engineer":            { displayName: "QA Engineer",            role: "qa",         title: "Quality Assurance",             icon: "shield" },
  "architect":              { displayName: "Architect",              role: "engineer",   title: "System Architecture",           icon: "brain" },
  "backend-architect":      { displayName: "Backend Architect",      role: "engineer",   title: "Backend Architecture",          icon: "cpu" },
  "frontend-developer":     { displayName: "Frontend Developer",     role: "designer",   title: "Frontend & Design",             icon: "sparkles" },
  "security-engineer":      { displayName: "Security Engineer",      role: "engineer",   title: "Security",                      icon: "shield" },
  "devops-engineer":        { displayName: "DevOps Engineer",        role: "devops",     title: "Infrastructure & DevOps",       icon: "hammer" },
  "database-architect":     { displayName: "Database Architect",     role: "engineer",   title: "Database Design",               icon: "cpu" },
  "researcher":             { displayName: "Researcher",             role: "researcher", title: "Research & Analysis",           icon: "search" },
  "test-engineer":          { displayName: "Test Engineer",          role: "qa",         title: "Test Engineering",              icon: "code" },
  "technical-writer":       { displayName: "Technical Writer",       role: "general",    title: "Documentation",                 icon: "bot" },
  "refactoring-specialist": { displayName: "Refactoring Specialist", role: "engineer",   title: "Code Quality & Refactoring",    icon: "wrench" },
  "full-stack":             { displayName: "Full Stack Agent",       role: "engineer",   title: "Full Stack Development",        icon: "code" },
  "lead-scout":             { displayName: "Lead Scout",             role: "researcher", title: "Lead Generation & Outreach",    icon: "search" },
};

// ---------------------------------------------------------------------------
// Hierarchy derivation from CHANNEL_CONFIG
// ---------------------------------------------------------------------------

/**
 * Derive reportsTo relationships from CHANNEL_CONFIG.
 * Returns a map of mastraAgentId → managerMastraAgentId (or null for CEO).
 */
function deriveHierarchy(): Map<string, string | null> {
  const hierarchy = new Map<string, string | null>();

  // co-founder is the root — reports to nobody
  hierarchy.set("co-founder", null);

  // Channel primaries report to co-founder (except co-founder itself)
  for (const config of Object.values(CHANNEL_CONFIG)) {
    if (config.primary !== "co-founder") {
      if (!hierarchy.has(config.primary)) {
        hierarchy.set(config.primary, "co-founder");
      }
    }
  }

  // Delegates report to their channel's primary
  for (const config of Object.values(CHANNEL_CONFIG)) {
    for (const delegate of config.canDelegate) {
      if (delegate === config.primary || delegate === "co-founder") continue;
      if (!hierarchy.has(delegate)) {
        hierarchy.set(delegate, config.primary);
      }
    }
  }

  // Agents not in any channel config → report to their closest logical parent
  const allMastraAgents = Object.keys(AGENT_META);
  for (const agentKey of allMastraAgents) {
    if (!hierarchy.has(agentKey)) {
      const meta = AGENT_META[agentKey];
      if (meta && (meta.role === "engineer" || meta.role === "qa" || meta.role === "devops")) {
        hierarchy.set(agentKey, "engineering-lead");
      } else {
        hierarchy.set(agentKey, "co-founder");
      }
    }
  }

  return hierarchy;
}

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

export interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

export function mastraSyncService(db: Db) {
  return {
    /**
     * Sync all Mastra agents into Paperclip's agents table.
     * Idempotent — safe to call repeatedly. Matches on adapterConfig->>'mastraAgentId'.
     */
    sync: async (companyId: string): Promise<SyncResult> => {
      const result: SyncResult = { synced: 0, created: 0, updated: 0, errors: [] };

      // 1. Fetch agent list from Mastra HTTP API
      let mastraAgents: Record<string, MastraAgentInfo>;
      try {
        mastraAgents = await listMastraAgents();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Failed to fetch Mastra agents: ${msg}`);
        logger.error({ err }, "mastra-sync: failed to fetch agents from Mastra API");
        return result;
      }

      // 2. Derive hierarchy
      const hierarchy = deriveHierarchy();

      // 3. Load existing Mastra agents from Paperclip DB (for upsert matching)
      const existingRows = await db
        .select({ id: agents.id, adapterConfig: agents.adapterConfig })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.adapterType, "mastra_local")));

      const existingByMastraId = new Map<string, string>();
      for (const row of existingRows) {
        const mastraId = (row.adapterConfig as Record<string, unknown>)?.mastraAgentId;
        if (typeof mastraId === "string") {
          existingByMastraId.set(mastraId, row.id);
        }
      }

      // 4. First pass: create/update all agents (without reportsTo, since we need UUIDs)
      const mastraIdToUuid = new Map<string, string>();

      for (const [agentKey, agentInfo] of Object.entries(mastraAgents)) {
        const meta = AGENT_META[agentKey];
        if (!meta) {
          result.errors.push(`Unknown agent key '${agentKey}' — no metadata defined, skipping`);
          continue;
        }

        const adapterConfig = {
          mastraAgentId: agentKey,
          mastraHost: process.env.MASTRA_URL ?? "http://localhost:4111",
        };

        const existingId = existingByMastraId.get(agentKey);

        try {
          if (existingId) {
            // Update existing agent
            await db
              .update(agents)
              .set({
                name: meta.displayName,
                role: meta.role,
                title: meta.title,
                icon: meta.icon,
                status: "active",
                adapterConfig,
                capabilities: agentInfo.description?.slice(0, 500) ?? meta.title,
                updatedAt: new Date(),
              })
              .where(eq(agents.id, existingId));

            mastraIdToUuid.set(agentKey, existingId);
            result.updated++;
          } else {
            // Create new agent
            const created = await db
              .insert(agents)
              .values({
                companyId,
                name: meta.displayName,
                role: meta.role,
                title: meta.title,
                icon: meta.icon,
                status: "active",
                adapterType: "mastra_local",
                adapterConfig,
                capabilities: agentInfo.description?.slice(0, 500) ?? meta.title,
              })
              .returning()
              .then((rows) => rows[0]);

            mastraIdToUuid.set(agentKey, created.id);
            result.created++;
          }

          result.synced++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to sync agent '${agentKey}': ${msg}`);
          logger.error({ err, agentKey }, "mastra-sync: failed to upsert agent");
        }
      }

      // 5. Second pass: set reportsTo relationships (now we have all UUIDs)
      for (const [agentKey, managerKey] of hierarchy) {
        const agentUuid = mastraIdToUuid.get(agentKey);
        if (!agentUuid) continue;

        const managerUuid = managerKey ? mastraIdToUuid.get(managerKey) ?? null : null;

        try {
          await db
            .update(agents)
            .set({ reportsTo: managerUuid, updatedAt: new Date() })
            .where(eq(agents.id, agentUuid));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to set reportsTo for '${agentKey}': ${msg}`);
        }
      }

      logger.info(
        { companyId, synced: result.synced, created: result.created, updated: result.updated },
        "mastra-sync: completed",
      );

      return result;
    },
  };
}
