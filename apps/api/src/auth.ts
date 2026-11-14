import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { agentsStore } from "./agents-store";
import { type AuthMethod, runAsUser } from "./context";
import { keepDemoWeekFresh } from "./demo/sync";
import { env } from "./env";
import { errorResponse } from "./http";
import { mcpResource, resourceMetadataUrl } from "./public-url";
import { verifyAccessToken } from "./routes/oauth";
import { store } from "./store";
import { isPersonalToken, userForPersonalToken } from "./tokens";

const digest = (s: string) => createHash("sha256").update(s).digest();
const expected = digest(env.API_KEY);

// Constant-time comparison (hashing first equalises lengths).
const isApiKey = (token: string) => timingSafeEqual(digest(token), expected);

const supabase =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

// Verified Supabase access tokens, cached briefly so every request doesn't round-trip to Auth.
const tokenCache = new Map<string, { userId: string; until: number }>();
const TOKEN_TTL_MS = 60_000;

async function userFromSupabaseToken(token: string): Promise<string | null> {
  if (!supabase) return null;
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.userId;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  tokenCache.set(token, { userId: data.user.id, until: Date.now() + TOKEN_TTL_MS });
  if (tokenCache.size > 1000) tokenCache.clear();
  return data.user.id;
}

/**
 * Deletes the current sign in (Supabase Auth user) for DELETE /v1/me/data. False when Auth is not
 * configured (in-memory store) or Supabase refused; the data is already gone either way.
 */
export async function deleteAuthUser(userId: string): Promise<boolean> {
  for (const [token, hit] of tokenCache) if (hit.userId === userId) tokenCache.delete(token);
  if (!supabase) return false;
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) console.error(`[auth] could not delete auth user ${userId}: ${error.message}`);
  return !error;
}

/**
 * Resolves who the request acts for and runs the rest of the request as that user:
 * - a signed-in user's Supabase access token (`Authorization: Bearer <jwt>`) -> that user
 * - the shared API key -> the demo account (collectors, webhooks, our own tools)
 * - with `mcp`, an OAuth access token issued by routes/oauth.ts for this MCP resource -> the user
 *   who allowed it (the claude.ai connector). A 401 then carries the WWW-Authenticate pointer to
 *   the protected resource metadata, which is how claude.ai starts sign in.
 * `allowQueryKey` (implied by `mcp`) also accepts `?key=` for callers that cannot set headers
 * (webhook senders, older connector setups). URLs end up in logs, so only enable it where needed.
 */
// The only routes a device key (mk_...) may call: sending data, and the one read the Mac collector
// needs to enforce focus guards (#41). A leaked key can neither read the day nor change anything.
export const deviceKeyMayCall = (method: string, path: string) =>
  (method === "POST" &&
    (path === "/v1/events" || path === "/v1/events/batch" || path.startsWith("/v1/webhooks/"))) ||
  (method === "GET" && path === "/v1/focus-guards/active");

export const requireUser =
  (opts: { allowQueryKey?: boolean; mcp?: boolean } = {}): MiddlewareHandler =>
  async (c, next) => {
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    const token = bearer ?? (opts.allowQueryKey || opts.mcp ? c.req.query("key") : undefined);
    const deny = (message: string) => {
      if (opts.mcp) {
        const params = [`resource_metadata="${resourceMetadataUrl(c)}"`];
        if (token) params.push('error="invalid_token"');
        c.header("WWW-Authenticate", `Bearer ${params.join(", ")}`);
      }
      return errorResponse(c, "unauthorized", message);
    };
    if (!token) return deny("Sign in, or send the API key");

    let userId: string | null;
    let via: AuthMethod;
    let agentId: string | null = null;
    if (isApiKey(token)) {
      userId = env.DEMO_USER_ID;
      via = "api_key";
    } else if (isPersonalToken(token)) {
      // Device keys (Mac collector, Health Auto Export) made by the person in the app.
      userId = await userForPersonalToken(token);
      via = "personal_token";
    } else if (opts.mcp && token.startsWith("mcp_at_")) {
      const oauth = await verifyAccessToken(token, mcpResource(c));
      userId = oauth?.user_id ?? null;
      agentId = oauth?.agent_id ?? null;
      via = "mcp_oauth";
    } else {
      userId = await userFromSupabaseToken(token);
      via = "session";
    }
    if (!userId) return deny("Invalid or expired credentials");
    // Device keys only send data (plus the focus guard read): no MCP, no settings, no credentials.
    if (via === "personal_token" && !deviceKeyMayCall(c.req.method, c.req.path)) {
      return errorResponse(c, "forbidden", "Device keys can only send data to Michael");
    }

    // The demo account's generated week follows the clock (at most one refresh per 5 minutes).
    if (userId === env.DEMO_USER_ID) await runAsUser(userId, () => keepDemoWeekFresh(store), via);

    if (agentId) {
      // The agent behind the token: its current scopes apply and every tool call is logged.
      const uid = userId;
      const agent = await runAsUser(uid, () => agentsStore.getAgent(agentId), via);
      if (!agent || agent.status === "revoked") return deny("This agent was revoked. Connect it again.");
      await runAsUser(uid, () => next(), via, agent);
      return;
    }
    await runAsUser(userId, () => next(), via);
  };
