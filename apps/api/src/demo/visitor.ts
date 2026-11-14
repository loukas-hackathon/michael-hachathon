import { z } from "zod";

// Demo visitors: people browsing the demo week in the web app without signing in. They all share
// the demo account, so they may look at everything but only change what is undoable or their own:
// their own chat (stored per visitor), doing, undoing or dismissing a recommendation, asking for a
// brief, and turning nudges on for their device. Everything that changes the account itself
// (privacy, goals, instructions, places, profile, integrations, agents, keys, data deletion) is
// refused, so no visitor can change the stage for the next one. MCP tokens and the API key keep
// full access: only the web visitor path is restricted.

/** The header the web app sends (server to server) with the API key. */
export const DEMO_VISITOR_HEADER = "x-michael-demo-visitor";

/** A random id the web app made for one visitor (a UUID), never anything meaningful. */
export const DemoVisitorId = z.uuid();

export const DEMO_VISITOR_MESSAGE = "This is the demo week. Sign in with Google to make it yours.";

// Writes a demo visitor may make: [method, path pattern]. Reads (GET, HEAD) are allowed.
const ALLOWED: [string, RegExp][] = [
  ["POST", /^\/v1\/chat(\/stream)?$/],
  ["POST", /^\/v1\/recommendations\/[^/]+\/(execute|undo)$/],
  ["PATCH", /^\/v1\/recommendations\/[^/]+$/],
  ["POST", /^\/v1\/analysis\/run$/],
  ["POST", /^\/v1\/travel\/plan$/],
  ["POST", /^\/v1\/focus-guards\/suggest$/],
  // "Seen" on a personal record card, so it is not announced again.
  ["POST", /^\/v1\/records\/[^/]+\/announced$/],
  // Michael reading his reply aloud (no state).
  ["POST", /^\/v1\/voice\/speak$/],
  ["POST", /^\/v1\/push\/subscriptions$/],
  ["DELETE", /^\/v1\/push\/subscriptions$/],
  ["POST", /^\/v1\/nudges\/test$/],
];

// Never for a visitor, not even to read: device keys, ingest and MCP belong to real callers.
const NEVER: RegExp[] = [/^\/mcp$/, /^\/v1\/webhooks(\/|$)/, /^\/v1\/tokens(\/|$)/];

/** True when a demo visitor may make this request. Unknown writes are refused (fail closed). */
export function demoVisitorMay(method: string, path: string): boolean {
  const p = path.replace(/\/+$/, "") || "/";
  if (NEVER.some((r) => r.test(p))) return false;
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  return ALLOWED.some(([am, r]) => am === m && r.test(p));
}
