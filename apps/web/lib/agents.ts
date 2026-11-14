import "server-only";
import type { AgentClient, AgentQuery, AgentScope } from "@michael/shared";

// Michael for agents, from the user's side. Shapes are the contract's (AgentClient, AgentQuery);
// SAMPLE DATA until GET /v1/agents and /v1/agents/queries are live (docs/api.md, status stub).

export const SCOPE_LABEL: Record<AgentScope, string> = {
  timeline: "Your day",
  goals: "Goals",
  recommendations: "Michael's advice",
  score: "Score",
  write_events: "Adding to your day",
};

const at = (hhmm: string) => `2026-11-11T${hhmm}:00+02:00`;
const CLAUDE = "40000000-0000-4000-8000-000000000001";
const CURSOR = "40000000-0000-4000-8000-000000000002";

const sampleAgents: AgentClient[] = [
  {
    id: CURSOR,
    name: "Cursor",
    status: "pending",
    scopes: ["timeline"],
    created_at: at("08:40"),
    last_seen_at: at("08:40"),
  },
  {
    id: CLAUDE,
    name: "Claude",
    status: "approved",
    scopes: ["timeline", "goals", "score"],
    created_at: "2026-11-09T10:12:00+02:00",
    last_seen_at: at("14:02"),
  },
];

const sampleQueries: AgentQuery[] = [
  {
    id: "41000000-0000-4000-8000-000000000003",
    agent_id: CLAUDE,
    tool: "get_timeline",
    summary: "Is Manolis free and fit for a hard 07:00 run tomorrow?",
    allowed: true,
    created_at: at("14:02"),
  },
  {
    id: "41000000-0000-4000-8000-000000000002",
    agent_id: CLAUDE,
    tool: "get_timeline",
    summary: "Free between 15:00 and 17:00?",
    allowed: true,
    created_at: at("09:15"),
  },
  {
    id: "41000000-0000-4000-8000-000000000001",
    agent_id: CURSOR,
    tool: "get_timeline",
    summary: "When is the next deep work block?",
    allowed: false,
    created_at: at("08:40"),
  },
];

export type AgentsView = { sample: boolean; agents: AgentClient[]; queries: AgentQuery[] };

/** `variant` previews states (?demo=empty|error). */
export async function getAgents(variant?: string): Promise<AgentsView> {
  if (variant === "error") throw new Error("Preview of the error state");
  if (variant === "empty") return { sample: true, agents: [], queries: [] };
  return { sample: true, agents: sampleAgents, queries: sampleQueries };
}

/** "Claude, twice" / "Claude, twice, and Cursor, once". Counts only questions that were answered. */
export function whoAsked(view: AgentsView) {
  const counts = new Map<string, number>();
  for (const q of view.queries) {
    if (!q.allowed) continue;
    const name = view.agents.find((a) => a.id === q.agent_id)?.name ?? "An agent";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const word = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
  return [...counts.entries()].map(([name, n]) => `${name}, ${word(n)}`);
}
