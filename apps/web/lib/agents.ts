import "server-only";
import type { AgentClient, AgentClientUpdate, AgentQuery, AgentScope } from "@michael/shared";
import { API_URL, bearer } from "./api";

// Michael for agents, from the user's side. Shapes are the contract's (AgentClient, AgentQuery).
// Real data from the API; the sample below is for USE_MOCKS and ?demo=sample.

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

const USE_MOCKS = process.env.USE_MOCKS !== "false";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await bearer()}`, "content-type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The user's agents and today's questions (GET /v1/agents, /v1/agents/queries).
 * Sample data with USE_MOCKS; `variant` previews states (?demo=sample|empty|error).
 */
export async function getAgents(variant?: string): Promise<AgentsView> {
  if (variant === "error") throw new Error("Preview of the error state");
  if (variant === "empty") return { sample: true, agents: [], queries: [] };
  if (USE_MOCKS || variant === "sample")
    return { sample: true, agents: sampleAgents, queries: sampleQueries };
  const [{ agents }, { queries }] = await Promise.all([
    api<{ agents: AgentClient[] }>("/v1/agents"),
    api<{ queries: AgentQuery[] }>("/v1/agents/queries"),
  ]);
  return { sample: false, agents, queries };
}

/** Approve, revoke or change scopes (PATCH /v1/agents/:id). Sample agents only pretend. */
export async function patchAgent(id: string, patch: AgentClientUpdate): Promise<AgentClient | null> {
  if (USE_MOCKS || sampleAgents.some((a) => a.id === id)) return null;
  return api<AgentClient>(`/v1/agents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
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
