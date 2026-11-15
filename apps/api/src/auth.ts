import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { agentsStore } from "./agents-store";
import { type AuthMethod, runAsUser } from "./context";
import { demoRefreshGate, keepDemoWeekFresh } from "./demo/sync";
import {
  DEMO_PRESENTER_HEADER,
  DEMO_VISITOR_HEADER,
  DEMO_VISITOR_MESSAGE,
  DemoVisitorId,
  demoVisitorMay,
} from "./demo/visitor";
import { env } from "./env";
import { errorResponse } from "./http";
import { mcpResource, resourceMetadataUrl } from "./public-url";
import { verifyAccessToken } from "./routes/oauth";
import { store } from "./store";
import { currentTiming, dbClient, untimed } from "./timing";
import { isPersonalToken, userForPersonalToken } from "./tokens";

const digest = (s: string) => createHash("sha256").update(s).digest();
const expected = digest(env.API_KEY);

// Constant-time comparison (hashing first equalises lengths).
const isApiKey = (token: string) => timingSafeEqual(digest(token), expected);

// The presenter key (demo/visitor.ts), only when configured. Constant time as well.
const presenterKey = env.DEMO_PRESENTER_KEY?.trim() ? digest(env.DEMO_PRESENTER_KEY.trim()) : null;
const isPresenterKey = (value: string | undefined) =>
  Boolean(presenterKey && value && timingSafeEqual(digest(value.trim()), presenterKey));

// `e2e_<uuid>`: a test user, accepted only with E2E_TEST_AUTH=on (see env.ts).
const E2E_TOKEN = /^e2e_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const supabase =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? dbClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// Verified Supabase access tokens, cached briefly (never past the token's own expiry).
const tokenCache = new Map<string, { userId: string; until: number }>();
const TOKEN_TTL_MS = 60_000;

/**
 * The signed-in user behind a Supabase access token. getClaims checks the signature locally
 * against the project's signing keys (JWKS, fetched once and cached by supabase-js) and the
 * expiry, so a fresh token costs no round trip to Auth (#234). Projects still on a shared HS256
 * secret fall back to asking Auth (getUser) inside getClaims.
 */
async function userFromSupabaseToken(token: string): Promise<string | null> {
  if (!supabase) return null;
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.userId;
  const { data, error } = await supabase.auth.getClaims(token);
  const claims = data?.claims;
  // Only end user sessions: never the anon or service role keys, which carry no user.
  if (error || !claims?.sub || claims.role !== "authenticated") return null;
  const expiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : Date.now();
  tokenCache.set(token, { userId: claims.sub, until: Math.min(Date.now() + TOKEN_TTL_MS, expiresAt) });
  if (tokenCache.size > 1000) tokenCache.clear();
  return claims.sub;
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
 * - the API key with X-Michael-Demo-Visitor -> the demo account for one anonymous web visitor:
 *   read mostly, chat of their own (demo/visitor.ts); with X-Michael-Demo-Presenter holding
 *   DEMO_PRESENTER_KEY, the presenter, who may also answer the claude.ai consent
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
    (path === "/v1/events" ||
      path === "/v1/events/batch" ||
      path === "/v1/location/signals" ||
      path.startsWith("/v1/webhooks/"))) ||
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
    const authStart = performance.now();

    let userId: string | null;
    let via: AuthMethod;
    let agentId: string | null = null;
    let visitor: string | undefined;
    if (env.E2E_TEST_AUTH === "on" && E2E_TOKEN.test(token)) {
      // Test sign in for the end-to-end suite; env.ts refuses it outside the in-memory store.
      userId = token.slice(4);
      via = "session";
    } else if (isApiKey(token)) {
      userId = env.DEMO_USER_ID;
      via = "api_key";
      // The web app browsing the demo week for one anonymous visitor: read mostly, own chat.
      const raw = c.req.header(DEMO_VISITOR_HEADER);
      if (raw !== undefined) {
        const id = DemoVisitorId.safeParse(raw.trim());
        if (!id.success) return deny("Invalid demo visitor");
        visitor = id.data;
        via = "demo_visitor";
        // The presenter (one laptop, #343) may also answer the claude.ai consent.
        const presenter = isPresenterKey(c.req.header(DEMO_PRESENTER_HEADER));
        if (!demoVisitorMay(c.req.method, c.req.path, presenter)) {
          return errorResponse(c, "forbidden", DEMO_VISITOR_MESSAGE, { demo: true });
        }
      }
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
    const t = currentTiming();
    if (t) t.authMs += performance.now() - authStart;
    if (!userId) return deny("Invalid or expired credentials");
    // Device keys only send data (plus the focus guard read): no MCP, no settings, no credentials.
    if (via === "personal_token" && !deviceKeyMayCall(c.req.method, c.req.path)) {
      return errorResponse(c, "forbidden", "Device keys can only send data to Michael");
    }

    // The demo account's generated week follows the clock (at most one refresh per 5 minutes).
    // Refreshes run in the background, so a demo request never waits for about 20 round trips of
    // seeding. The first one starts with the process (index.ts); until it has finished a request
    // waits for it, but at most FIRST_REFRESH_WAIT_MS (#364): the week from before is still there.
    if (userId === env.DEMO_USER_ID) {
      const uid = userId;
      const refresh = untimed(() => runAsUser(uid, () => keepDemoWeekFresh(store), via));
      await demoRefreshGate(refresh);
    }

    if (agentId) {
      // The agent behind the token: its current scopes apply and every tool call is logged.
      const uid = userId;
      const agent = await runAsUser(uid, () => agentsStore.getAgent(agentId), via);
      if (!agent || agent.status === "revoked") return deny("This agent was revoked. Connect it again.");
      await runAsUser(uid, () => next(), via, agent);
      return;
    }
    await runAsUser(userId, () => next(), via, undefined, visitor);
  };
