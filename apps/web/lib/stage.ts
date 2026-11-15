import "server-only";
import type { AgentClient, AgentQuery, Nudge } from "@michael/shared";
import { API_URL } from "./api";
import { authHeaders } from "./caller";

// The live part of the stage view (/stage): today's latest nudge and who asked about the user.
// Polled by the browser every 3 seconds through /stage/feed, so it never sees a token.

export type StageNudge = Pick<Nudge, "id" | "text" | "reason" | "status" | "created_at">;
export type StageQuery = { id: string; at: string; agent: string; summary: string; allowed: boolean };
export type StageFeed = {
  nudge: StageNudge | null;
  /** Null when GET /v1/agents/queries is not live yet (501) or failed: the ticker hides. */
  queries: StageQuery[] | null;
};

async function call<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: await authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The newest nudge that actually went out today (suppressed ones were held back). */
export function latestNudge(nudges: Nudge[]): StageNudge | null {
  const out = nudges.filter((n) => n.status !== "suppressed");
  const n = out.reduce<Nudge | null>((a, b) => (!a || b.created_at >= a.created_at ? b : a), null);
  return n ? { id: n.id, text: n.text, reason: n.reason, status: n.status, created_at: n.created_at } : null;
}

export async function getStageFeed(): Promise<StageFeed> {
  const [nudges, queries, agents] = await Promise.all([
    call<{ nudges: Nudge[] }>("/v1/nudges"),
    call<{ queries: AgentQuery[] }>("/v1/agents/queries"),
    call<{ agents: AgentClient[] }>("/v1/agents"),
  ]);
  const names = new Map((agents?.agents ?? []).map((a) => [a.id, a.name]));
  return {
    nudge: latestNudge(nudges?.nudges ?? []),
    queries: queries
      ? [...queries.queries]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 3)
          .map((q) => ({
            id: q.id,
            at: q.created_at,
            agent: names.get(q.agent_id) ?? "An agent",
            summary: q.summary,
            allowed: q.allowed,
          }))
      : null,
  };
}
