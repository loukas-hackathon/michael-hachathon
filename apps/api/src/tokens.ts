import { createHash, randomBytes } from "node:crypto";
import type { PersonalToken } from "@michael/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentUserId } from "./context";
import { env } from "./env";
import { HttpError } from "./http";

// Personal tokens act for one user: collectors, webhooks and the Claude connector use them.
// Format "mk_<43 url-safe chars>"; only the sha256 is stored.
export const TOKEN_PREFIX = "mk_";
export const isPersonalToken = (s: string) => s.startsWith(TOKEN_PREFIX);
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

interface Row {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const toToken = (r: Row): PersonalToken => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  created_at: new Date(r.created_at).toISOString(),
  last_used_at: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
});

interface TokenBackend {
  insert(row: Omit<Row, "id" | "created_at" | "last_used_at" | "revoked_at">): Promise<Row>;
  byHash(tokenHash: string): Promise<Row | null>;
  list(userId: string): Promise<Row[]>;
  revoke(userId: string, id: string): Promise<boolean>;
  touch(id: string): Promise<void>;
}

class MemoryTokens implements TokenBackend {
  private rows: Row[] = [];
  async insert(r: Omit<Row, "id" | "created_at" | "last_used_at" | "revoked_at">) {
    const row: Row = {
      ...r,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
    };
    this.rows.push(row);
    return row;
  }
  async byHash(h: string) {
    return this.rows.find((r) => r.token_hash === h && !r.revoked_at) ?? null;
  }
  async list(userId: string) {
    return this.rows.filter((r) => r.user_id === userId && !r.revoked_at);
  }
  async revoke(userId: string, id: string) {
    const r = this.rows.find((x) => x.id === id && x.user_id === userId && !x.revoked_at);
    if (r) r.revoked_at = new Date().toISOString();
    return Boolean(r);
  }
  async touch(id: string) {
    const r = this.rows.find((x) => x.id === id);
    if (r) r.last_used_at = new Date().toISOString();
  }
}

class SupabaseTokens implements TokenBackend {
  constructor(private db: SupabaseClient) {}
  private ok<T>(res: { data: T; error: { message: string } | null }): T {
    if (res.error) throw new HttpError("upstream_error", `Database error: ${res.error.message}`);
    return res.data;
  }
  async insert(r: Omit<Row, "id" | "created_at" | "last_used_at" | "revoked_at">) {
    return this.ok(await this.db.from("personal_tokens").insert(r).select("*").single()) as Row;
  }
  async byHash(h: string) {
    return this.ok(
      await this.db
        .from("personal_tokens")
        .select("*")
        .eq("token_hash", h)
        .is("revoked_at", null)
        .maybeSingle(),
    ) as Row | null;
  }
  async list(userId: string) {
    return this.ok(
      await this.db
        .from("personal_tokens")
        .select("*")
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
    ) as Row[];
  }
  async revoke(userId: string, id: string) {
    const rows = this.ok(
      await this.db
        .from("personal_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("id", id)
        .is("revoked_at", null)
        .select("id"),
    ) as { id: string }[];
    return rows.length > 0;
  }
  async touch(id: string) {
    await this.db.from("personal_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", id);
  }
}

const backend: TokenBackend =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseTokens(
        createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
      )
    : new MemoryTokens();

// Resolved tokens are cached briefly; revocation takes effect within the TTL.
const cache = new Map<string, { userId: string; id: string; until: number }>();
const TTL_MS = 30_000;

/** Returns the user a personal token acts for, or null if unknown or revoked. */
export async function userForPersonalToken(secret: string): Promise<string | null> {
  const h = hash(secret);
  const hit = cache.get(h);
  if (hit && hit.until > Date.now()) return hit.userId;
  const row = await backend.byHash(h);
  if (!row) return null;
  cache.set(h, { userId: row.user_id, id: row.id, until: Date.now() + TTL_MS });
  if (cache.size > 1000) cache.clear();
  void backend.touch(row.id).catch(() => {});
  return row.user_id;
}

export async function createPersonalToken(name: string) {
  const secret = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const row = await backend.insert({
    user_id: currentUserId(),
    name,
    prefix: secret.slice(0, 7),
    token_hash: hash(secret),
  });
  return { token: toToken(row), secret };
}

export async function listPersonalTokens() {
  return (await backend.list(currentUserId())).map(toToken);
}

export async function revokePersonalToken(id: string) {
  cache.clear();
  return backend.revoke(currentUserId(), id);
}
