import type { MiddlewareHandler } from "hono";
import { env } from "./env";
import { errorResponse } from "./http";

// Provisional single-user auth: shared API key.
// Accepts `Authorization: Bearer <key>`, or `?key=<key>` for webhook senders that cannot set headers.
export const requireApiKey: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : c.req.query("key");
  if (token !== env.API_KEY) {
    return errorResponse(c, "unauthorized", "Missing or invalid API key");
  }
  await next();
};
