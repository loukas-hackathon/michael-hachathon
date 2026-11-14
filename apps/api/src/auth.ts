import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { env } from "./env";
import { errorResponse } from "./http";

const digest = (s: string) => createHash("sha256").update(s).digest();
const expected = digest(env.API_KEY);

// Constant-time comparison (hashing first equalises lengths).
const isValidKey = (token: string | undefined) =>
  token !== undefined && timingSafeEqual(digest(token), expected);

/**
 * Provisional single-user auth: one shared API key sent as `Authorization: Bearer <key>`.
 * `allowQueryKey` additionally accepts `?key=<key>`. Enable it ONLY for callers that cannot set
 * headers (webhook senders, claude.ai custom connectors on /mcp), because URLs end up in logs.
 */
export const requireApiKey =
  (opts: { allowQueryKey?: boolean } = {}): MiddlewareHandler =>
  async (c, next) => {
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const token = bearer ?? (opts.allowQueryKey ? c.req.query("key") : undefined);
    if (!isValidKey(token)) {
      return errorResponse(c, "unauthorized", "Missing or invalid API key");
    }
    await next();
  };
