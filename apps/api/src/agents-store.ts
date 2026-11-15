import type { AgentClient, AgentClientUpdate, AgentQuery, AgentScope } from "@michael/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { currentUserId } from "./context";
import { env } from "./env";
import { type DbError, dbError } from "./http";
import { dbClient } from "./timing";

// Michael for agents (#38): the agents a user allowed and every question they asked. Kept apart
// from store.ts so it can grow without touching the shared Store, but scoped the same way:
// every query filters by currentUserId(), never by an id from the request.

export type QueryLog = Pick<AgentQuery, "agent_id" | "tool" | "summary" | "allowed"> & {
  recommendation_id?: string | null;
  /** True: the call changed something. False: a change was tried and nothing changed. Null: a read. */
  changed?: boolean | null;
};

export interface AgentsStore {
  listAgents(): Promise<AgentClient[]>;
  getAgent(id: string): Promise<AgentClient | null>;
  /** The consent tap: create or refresh the user's agent with this name, approved. */
  approveAgent(name: string, oauthClientId: string, scopes: AgentScope[]): Promise<AgentClient>;
  updateAgent(id: string, patch: z.output<typeof AgentClientUpdate>): Promise<AgentClient | null>;
  /** Logs one tool call and marks the agent as seen. */
  logQuery(q: QueryLog): Promise<void>;
  listQueries(range: { from: string; to: string }): Promise<AgentQuery[]>;
}

const now = () => new Date().toISOString();

export class MemoryAgentsStore implements AgentsStore {
  private agents = new Map<string, (AgentClient & { user_id: string })[]>();
  private queries = new Map<string, AgentQuery[]>();
  private get mine() {
    const u = currentUserId();
    if (!this.agents.has(u)) this.agents.set(u, []);
    return this.agents.get(u) as (AgentClient & { user_id: string })[];
  }
  private get myQueries() {
    const u = currentUserId();
    if (!this.queries.has(u)) this.queries.set(u, []);
    return this.queries.get(u) as AgentQuery[];
  }
  private strip = ({ user_id: _, ...a }: AgentClient & { user_id: string }): AgentClient => ({ ...a });

  async listAgents() {
    return this.mine.map(this.strip).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async getAgent(id: string) {
    const a = this.mine.find((x) => x.id === id);
    return a ? this.strip(a) : null;
  }
  async approveAgent(name: string, _oauthClientId: string, scopes: AgentScope[]) {
    let a = this.mine.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!a) {
      a = {
        id: crypto.randomUUID(),
        user_id: currentUserId(),
        name,
        status: "approved",
        scopes,
        created_at: now(),
        last_seen_at: null,
      };
      this.mine.push(a);
    }
    Object.assign(a, { status: "approved", scopes });
    return this.strip(a);
  }
  async updateAgent(id: string, patch: z.output<typeof AgentClientUpdate>) {
    const a = this.mine.find((x) => x.id === id);
    if (!a) return null;
    if (patch.status) a.status = patch.status;
    if (patch.scopes) a.scopes = [...new Set(patch.scopes)];
    return this.strip(a);
  }
  async logQuery(q: QueryLog) {
    const created_at = now();
    this.myQueries.push({
      id: crypto.randomUUID(),
      ...q,
      recommendation_id: q.recommendation_id ?? null,
      changed: q.changed ?? null,
      created_at,
    });
    const a = this.mine.find((x) => x.id === q.agent_id);
    if (a) a.last_seen_at = created_at;
  }
  async listQueries({ from, to }: { from: string; to: string }) {
    const f = Date.parse(from);
    const t = Date.parse(to);
    return this.myQueries
      .filter((q) => Date.parse(q.created_at) >= f && Date.parse(q.created_at) <= t)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const toAgent = (r: Record<string, unknown>): AgentClient => ({
  id: r.id as string,
  name: r.name as string,
  status: r.status as AgentClient["status"],
  scopes: (r.scopes as AgentScope[]) ?? [],
  created_at: iso(r.created_at) as string,
  last_seen_at: iso(r.last_seen_at),
});
const toQuery = (r: Record<string, unknown>): AgentQuery => ({
  id: r.id as string,
  agent_id: r.agent_id as string,
  tool: r.tool as string,
  summary: (r.summary as string) ?? "",
  allowed: r.allowed as boolean,
  created_at: iso(r.created_at) as string,
  recommendation_id: (r.recommendation_id as string | null | undefined) ?? null,
  changed: (r.changed as boolean | null | undefined) ?? null,
});
const AGENT_COLUMNS = "id, name, status, scopes, created_at, last_seen_at";

function check<T>(res: { data: T; error: DbError | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data;
}

// Agents looked up on every MCP call (auth.ts), cached briefly per user and id. Writes go through
// this store (one API process), which drops the entry, so a revoke applies at once.
const AGENT_TTL_MS = 30_000;

export class SupabaseAgentsStore implements AgentsStore {
  private db: SupabaseClient;
  private agentCache = new Map<string, { agent: AgentClient | null; until: number }>();
  constructor(url: string, serviceRoleKey: string) {
    this.db = dbClient(url, serviceRoleKey);
  }

  async listAgents() {
    const rows = check(
      await this.db
        .from("agent_clients")
        .select(AGENT_COLUMNS)
        .eq("user_id", currentUserId())
        .order("created_at", { ascending: false }),
    );
    return (rows ?? []).map(toAgent);
  }
  async getAgent(id: string) {
    const key = `${currentUserId()}:${id}`;
    const hit = this.agentCache.get(key);
    if (hit && hit.until > Date.now()) return hit.agent;
    const row = check(
      await this.db
        .from("agent_clients")
        .select(AGENT_COLUMNS)
        .eq("user_id", currentUserId())
        .eq("id", id)
        .maybeSingle(),
    );
    const agent = row ? toAgent(row) : null;
    if (this.agentCache.size > 1000) this.agentCache.clear();
    this.agentCache.set(key, { agent, until: Date.now() + AGENT_TTL_MS });
    return agent;
  }
  async approveAgent(name: string, oauthClientId: string, scopes: AgentScope[]) {
    const userId = currentUserId();
    this.agentCache.clear();
    // One row per user and name (unique on lower(name)); PostgREST cannot upsert on an
    // expression index, so look first.
    const existing = check(
      await this.db
        .from("agent_clients")
        .select("id")
        .eq("user_id", userId)
        .ilike("name", name.replace(/[%_\\]/g, "\\$&"))
        .limit(1),
    );
    const values = { status: "approved", scopes, oauth_client_id: oauthClientId };
    const row = existing?.[0]
      ? check(
          await this.db
            .from("agent_clients")
            .update(values)
            .eq("id", existing[0].id)
            .eq("user_id", userId)
            .select(AGENT_COLUMNS)
            .single(),
        )
      : check(
          await this.db
            .from("agent_clients")
            .insert({ ...values, name, user_id: userId })
            .select(AGENT_COLUMNS)
            .single(),
        );
    return toAgent(row as Record<string, unknown>);
  }
  async updateAgent(id: string, patch: z.output<typeof AgentClientUpdate>) {
    const values: Record<string, unknown> = {};
    if (patch.status) values.status = patch.status;
    if (patch.scopes) values.scopes = [...new Set(patch.scopes)];
    if (!Object.keys(values).length) return this.getAgent(id);
    this.agentCache.delete(`${currentUserId()}:${id}`);
    const rows = check(
      await this.db
        .from("agent_clients")
        .update(values)
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select(AGENT_COLUMNS),
    );
    return rows?.[0] ? toAgent(rows[0]) : null;
  }
  async logQuery(q: QueryLog) {
    const userId = currentUserId();
    const created_at = now();
    // recommendation_id and changed only when there is one, so plain reads never depend on
    // either column.
    const row = {
      agent_id: q.agent_id,
      tool: q.tool,
      summary: q.summary,
      allowed: q.allowed,
      ...(q.recommendation_id ? { recommendation_id: q.recommendation_id } : {}),
      user_id: userId,
      created_at,
    };
    const insert = async () => {
      if (q.changed == null) return this.db.from("agent_queries").insert(row);
      const res = await this.db.from("agent_queries").insert({ ...row, changed: q.changed });
      // Until the `changed` migration has run, keep the line (it already says what happened).
      return res.error?.message.includes("changed") ? this.db.from("agent_queries").insert(row) : res;
    };
    const [ins, upd] = await Promise.all([
      insert(),
      this.db
        .from("agent_clients")
        .update({ last_seen_at: created_at })
        .eq("user_id", userId)
        .eq("id", q.agent_id),
    ]);
    check(ins);
    check(upd);
  }
  async listQueries({ from, to }: { from: string; to: string }) {
    const read = (columns: string) =>
      this.db
        .from("agent_queries")
        .select(columns)
        .eq("user_id", currentUserId())
        .gte("created_at", from)
        .lte("created_at", to)
        .order("created_at", { ascending: false })
        .limit(500);
    const base = "id, agent_id, tool, summary, allowed, created_at";
    let res = await read(`${base}, recommendation_id, changed`);
    // Until the `changed` migration has run, read the log without it; the same for the older
    // recommendation_id one.
    if (res.error?.message.includes("changed")) res = await read(`${base}, recommendation_id`);
    if (res.error?.message.includes("recommendation_id")) res = await read(base);
    const rows = check(res) as unknown as Record<string, unknown>[] | null;
    return (rows ?? []).map(toQuery);
  }
}

export const agentsStore: AgentsStore =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseAgentsStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : new MemoryAgentsStore();
