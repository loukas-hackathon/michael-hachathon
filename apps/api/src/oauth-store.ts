import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { HttpError } from "./http";

// Storage for the MCP OAuth server (routes/oauth.ts). Not scoped by currentUserId(): it runs
// before the caller is known (a token lookup is how we learn who the caller is), so every
// function that touches a user takes the user id explicitly. Codes and tokens are stored hashed.

export type OAuthClient = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
};

/** One authorisation request: pending until the user answers on the consent page, then a code. */
export type OAuthGrant = {
  id: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  scopes: string[];
  resource: string;
  user_id: string | null;
  code_hash: string | null;
  expires_at: string;
  used_at: string | null;
};

export type OAuthToken = {
  id: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  resource: string;
  access_hash: string;
  refresh_hash: string;
  access_expires_at: string;
  refresh_expires_at: string;
  revoked_at: string | null;
};

export type TokenRotation = Pick<
  OAuthToken,
  "access_hash" | "refresh_hash" | "access_expires_at" | "refresh_expires_at"
>;

export interface OAuthStore {
  createClient(client: OAuthClient): Promise<void>;
  getClient(clientId: string): Promise<OAuthClient | null>;
  createGrant(grant: OAuthGrant): Promise<void>;
  getGrant(id: string): Promise<OAuthGrant | null>;
  approveGrant(id: string, userId: string, codeHash: string, expiresAt: string): Promise<OAuthGrant | null>;
  deleteGrant(id: string): Promise<void>;
  /** Marks the code used and returns its grant; null if unknown or already used. Single use. */
  consumeCode(codeHash: string): Promise<OAuthGrant | null>;
  createToken(token: OAuthToken): Promise<void>;
  tokenByAccessHash(accessHash: string): Promise<OAuthToken | null>;
  /** Swaps a live refresh token for new hashes (rotation); null if unknown, revoked or expired. */
  rotateRefresh(refreshHash: string, next: TokenRotation): Promise<OAuthToken | null>;
}

const isLive = (expiresAt: string) => Date.parse(expiresAt) > Date.now();

export class MemoryOAuthStore implements OAuthStore {
  private clients = new Map<string, OAuthClient>();
  private grants = new Map<string, OAuthGrant>();
  private tokens = new Map<string, OAuthToken>();

  async createClient(client: OAuthClient) {
    this.clients.set(client.client_id, client);
  }
  async getClient(clientId: string) {
    return this.clients.get(clientId) ?? null;
  }
  async createGrant(grant: OAuthGrant) {
    this.grants.set(grant.id, grant);
  }
  async getGrant(id: string) {
    return this.grants.get(id) ?? null;
  }
  async approveGrant(id: string, userId: string, codeHash: string, expiresAt: string) {
    const g = this.grants.get(id);
    if (!g || g.user_id) return null;
    Object.assign(g, { user_id: userId, code_hash: codeHash, expires_at: expiresAt });
    return g;
  }
  async deleteGrant(id: string) {
    this.grants.delete(id);
  }
  async consumeCode(codeHash: string) {
    const g = [...this.grants.values()].find((x) => x.code_hash === codeHash);
    if (!g || g.used_at) return null;
    g.used_at = new Date().toISOString();
    return g;
  }
  async createToken(token: OAuthToken) {
    this.tokens.set(token.id, token);
  }
  async tokenByAccessHash(accessHash: string) {
    return [...this.tokens.values()].find((t) => t.access_hash === accessHash) ?? null;
  }
  async rotateRefresh(refreshHash: string, next: TokenRotation) {
    const t = [...this.tokens.values()].find((x) => x.refresh_hash === refreshHash);
    if (!t || t.revoked_at || !isLive(t.refresh_expires_at)) return null;
    Object.assign(t, next);
    return t;
  }
}

const iso = (v: unknown) => new Date(v as string).toISOString();
const isoOrNull = (v: unknown) => (v == null ? null : iso(v));

const toGrant = (r: Record<string, unknown>): OAuthGrant => ({
  id: r.id as string,
  client_id: r.client_id as string,
  redirect_uri: r.redirect_uri as string,
  state: (r.state as string | null) ?? null,
  code_challenge: r.code_challenge as string,
  scopes: (r.scopes as string[]) ?? [],
  resource: r.resource as string,
  user_id: (r.user_id as string | null) ?? null,
  code_hash: (r.code_hash as string | null) ?? null,
  expires_at: iso(r.expires_at),
  used_at: isoOrNull(r.used_at),
});

const toToken = (r: Record<string, unknown>): OAuthToken => ({
  id: r.id as string,
  client_id: r.client_id as string,
  user_id: r.user_id as string,
  scopes: (r.scopes as string[]) ?? [],
  resource: r.resource as string,
  access_hash: r.access_hash as string,
  refresh_hash: r.refresh_hash as string,
  access_expires_at: iso(r.access_expires_at),
  refresh_expires_at: iso(r.refresh_expires_at),
  revoked_at: isoOrNull(r.revoked_at),
});

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new HttpError("upstream_error", `Database error: ${res.error.message}`);
  return res.data;
}

export class SupabaseOAuthStore implements OAuthStore {
  private db: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async createClient(client: OAuthClient) {
    check(await this.db.from("oauth_clients").insert(client));
  }
  async getClient(clientId: string) {
    const row = check(
      await this.db.from("oauth_clients").select("*").eq("client_id", clientId).maybeSingle(),
    );
    return row ? { ...(row as OAuthClient), created_at: iso(row.created_at) } : null;
  }
  async createGrant(grant: OAuthGrant) {
    check(await this.db.from("oauth_grants").insert(grant));
  }
  async getGrant(id: string) {
    const row = check(await this.db.from("oauth_grants").select("*").eq("id", id).maybeSingle());
    return row ? toGrant(row) : null;
  }
  async approveGrant(id: string, userId: string, codeHash: string, expiresAt: string) {
    const rows = check(
      await this.db
        .from("oauth_grants")
        .update({ user_id: userId, code_hash: codeHash, expires_at: expiresAt })
        .eq("id", id)
        .is("user_id", null)
        .select(),
    );
    return rows?.[0] ? toGrant(rows[0]) : null;
  }
  async deleteGrant(id: string) {
    check(await this.db.from("oauth_grants").delete().eq("id", id));
  }
  async consumeCode(codeHash: string) {
    const rows = check(
      await this.db
        .from("oauth_grants")
        .update({ used_at: new Date().toISOString() })
        .eq("code_hash", codeHash)
        .is("used_at", null)
        .select(),
    );
    return rows?.[0] ? toGrant(rows[0]) : null;
  }
  async createToken(token: OAuthToken) {
    check(await this.db.from("oauth_tokens").insert(token));
  }
  async tokenByAccessHash(accessHash: string) {
    const row = check(
      await this.db.from("oauth_tokens").select("*").eq("access_hash", accessHash).maybeSingle(),
    );
    return row ? toToken(row) : null;
  }
  async rotateRefresh(refreshHash: string, next: TokenRotation) {
    const rows = check(
      await this.db
        .from("oauth_tokens")
        .update(next)
        .eq("refresh_hash", refreshHash)
        .is("revoked_at", null)
        .gt("refresh_expires_at", new Date().toISOString())
        .select(),
    );
    return rows?.[0] ? toToken(rows[0]) : null;
  }
}

export const oauthStore: OAuthStore =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseOAuthStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : new MemoryOAuthStore();
