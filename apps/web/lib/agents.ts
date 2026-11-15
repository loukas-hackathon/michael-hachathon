import "server-only";
import type { AgentClient, AgentClientUpdate, AgentQuery, AgentScope } from "@michael/shared";
import { authHeaders } from "./caller";
import { devLatency } from "./dev-latency";
import { API_URL, USE_MOCKS } from "./mode";

// Michael for agents, from the user's side. Shapes are the contract's (AgentClient, AgentQuery).
// Real data from the API; the sample below is for USE_MOCKS and ?demo=sample.

export const SCOPE_LABEL: Record<AgentScope, string> = {
  timeline: "Your day",
  goals: "Goals",
  recommendations: "Michael's advice",
  score: "Score",
  write_events: "Adding to your day",
};

/** Each scope in plain words, as a switch on the Agents screen: what it lets the agent do. */
export const SCOPE_COPY: Record<AgentScope, { title: string; detail: string }> = {
  timeline: { title: "Read your day", detail: "Calendar, watch and screen time as one timeline." },
  goals: { title: "Read and keep your goals", detail: "Goals, weekly budgets and your house rules." },
  recommendations: { title: "See my advice", detail: "What I suggest and why. It can accept or dismiss it." },
  score: { title: "See your score", detail: "Goal time spent so far, and the evening review." },
  write_events: {
    title: "Book time for you",
    detail: "Your own blocks only, never events with others. You can undo.",
  },
};

export const SCOPE_ORDER: AgentScope[] = ["timeline", "goals", "score", "recommendations", "write_events"];

// Tools that change something for the user. Everything else only reads.
const WRITE_TOOLS = new Set([
  "add_event",
  "add_goal",
  "update_goal",
  "update_recommendation",
  "execute_recommendation",
  "undo_recommendation",
  "create_focus_block",
  "block_mac_app",
  "plan_travel",
]);

export const isWrite = (q: AgentQuery) => WRITE_TOOLS.has(q.tool);

/** Is this the Claude connector? Reconnecting keeps one record named after the client. */
export const isClaude = (a: AgentClient) => /claude/i.test(a.name);

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
    last_seen_at: at("14:12"),
  },
];

const sampleQueries: AgentQuery[] = [
  {
    id: "41000000-0000-4000-8000-000000000005",
    agent_id: CLAUDE,
    tool: "get_score",
    summary: "Read your score",
    allowed: true,
    created_at: at("14:12"),
  },
  {
    id: "41000000-0000-4000-8000-000000000004",
    agent_id: CLAUDE,
    tool: "create_focus_block",
    summary: 'Booked "Sales focus" for Wed 15:00',
    allowed: true,
    created_at: at("14:04"),
    recommendation_id: "42000000-0000-4000-8000-000000000001",
    undo_until: at("15:00"),
  },
  {
    id: "41000000-0000-4000-8000-000000000003",
    agent_id: CLAUDE,
    tool: "get_timeline",
    summary: "Read your day from Wed 09:00 to Wed 18:00",
    allowed: true,
    created_at: at("14:02"),
  },
  {
    id: "41000000-0000-4000-8000-000000000002",
    agent_id: CLAUDE,
    tool: "get_goals",
    summary: "Read your goals",
    allowed: true,
    created_at: at("09:15"),
  },
  {
    id: "41000000-0000-4000-8000-000000000001",
    agent_id: CURSOR,
    tool: "get_timeline",
    summary: "Read your day",
    allowed: false,
    created_at: at("08:40"),
  },
];

export type AgentsView = { sample: boolean; agents: AgentClient[]; queries: AgentQuery[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The user's agents and today's questions (GET /v1/agents, /v1/agents/queries).
 * Sample data with USE_MOCKS; `variant` previews states
 * (?demo=sample|empty|connected|pending|error).
 */
export async function getAgents(variant?: string): Promise<AgentsView> {
  await devLatency();
  if (variant === "error") throw new Error("Preview of the error state");
  if (variant === "empty") return { sample: true, agents: [], queries: [] };
  if (variant === "connected" || variant === "pending") {
    // connected: Claude only; pending: Cursor waiting and Claude not connected yet.
    const keep = variant === "connected" ? CLAUDE : CURSOR;
    return {
      sample: true,
      agents: sampleAgents.filter((a) => a.id === keep),
      queries: sampleQueries.filter((q) => q.agent_id === keep),
    };
  }
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

/** One agent's day with Michael: its questions, newest first, and how many changed something. */
export type AgentDay = { agent: AgentClient; queries: AgentQuery[]; changes: number };

/** Today's log grouped by agent, the agent that asked last first. */
export function groupByAgent(view: AgentsView): AgentDay[] {
  const days = new Map<string, AgentDay>();
  for (const q of view.queries) {
    const agent = view.agents.find((a) => a.id === q.agent_id) ?? {
      id: q.agent_id,
      name: "An agent",
      status: "revoked" as const,
      scopes: [],
      created_at: q.created_at,
      last_seen_at: q.created_at,
    };
    const day = days.get(agent.id) ?? { agent, queries: [], changes: 0 };
    day.queries.push(q);
    if (q.allowed && isWrite(q)) day.changes += 1;
    days.set(agent.id, day);
  }
  return [...days.values()];
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** "4 questions, 1 change" for an agent's group header. */
export function countLine(day: AgentDay) {
  const asked = day.queries.length;
  const parts = [`${asked} ${asked === 1 ? "question" : "questions"}`];
  if (day.changes) parts.push(`${day.changes} ${day.changes === 1 ? "change" : "changes"}`);
  return parts.join(", ");
}

/** The headline: who asked, how often, and how many changes, as numbers for the sentence. */
export function headline(view: AgentsView) {
  const days = groupByAgent(view);
  const changes = days.reduce((n, d) => n + d.changes, 0);
  const asked = days.map((d) => ({ name: d.agent.name, times: times(d.queries.length) }));
  return { asked, changes };
}
