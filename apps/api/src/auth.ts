import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { runAsUser } from "./context";
import { env } from "./env";
import { errorResponse } from "./http";

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
 * Resolves who the request acts for and runs the rest of the request as that user:
 * - a signed-in user's Supabase access token (`Authorization: Bearer <jwt>`) -> that user
 * - the shared API key -> the demo account (collectors, webhooks, the claude.ai demo connector)
 * `allowQueryKey` also accepts `?key=` for callers that cannot set headers (webhook senders,
 * claude.ai custom connectors). URLs end up in logs, so only enable it where needed.
 */
export const requireUser =
  (opts: { allowQueryKey?: boolean } = {}): MiddlewareHandler =>
  async (c, next) => {
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const token = bearer ?? (opts.allowQueryKey ? c.req.query("key") : undefined);
    if (!token) return errorResponse(c, "unauthorized", "Sign in, or send the API key");

    const userId = isApiKey(token) ? env.DEMO_USER_ID : await userFromSupabaseToken(token);
    if (!userId) return errorResponse(c, "unauthorized", "Invalid or expired credentials");
    await runAsUser(userId, () => next());
  };
