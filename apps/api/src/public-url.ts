import type { Context } from "hono";
import { env } from "./env";

/**
 * The API's public base URL as the caller reached it (Railway terminates TLS, so the scheme comes
 * from x-forwarded-proto). The MCP resource is `${base}/mcp`, which must equal the URL the user
 * pasted into claude.ai, so it is derived from the request rather than configured.
 */
export function publicBase(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
  const host = c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || c.req.header("host") || url.host;
  return `${proto}://${host}`;
}

export const mcpResource = (c: Context) => `${publicBase(c)}/mcp`;
export const resourceMetadataUrl = (c: Context) =>
  `${publicBase(c)}/.well-known/oauth-protected-resource/mcp`;

/** Where the web app lives (consent page). PUBLIC_WEB_URL, else the first non local WEB_ORIGIN. */
export function publicWebUrl(): string {
  if (env.PUBLIC_WEB_URL) return env.PUBLIC_WEB_URL.replace(/\/$/, "");
  const origins = env.WEB_ORIGIN.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    origins.find((o) => !/localhost|127\.0\.0\.1/.test(o)) ??
    origins[0] ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}
