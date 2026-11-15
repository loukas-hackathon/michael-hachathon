import { z } from "zod";

// Demo visitors: people browsing the demo week in the web app without signing in. They all share
// the demo account, so they may look at everything but only change what is undoable or their own:
// their own chat (stored per visitor), doing, undoing or dismissing a recommendation, Book on
// Goals (undoable like Do it), the daily
// ritual, logging done time (all reset by the demo reseed), asking for a
// brief, and turning nudges on for their device. Everything that changes the account itself
// (privacy, goals, instructions, places, profile, integrations, agents, keys, data deletion) is
// refused, so no visitor can change the stage for the next one. MCP tokens and the API key keep
// full access: only the web visitor path is restricted.

/** The header the web app sends (server to server) with the API key. */
export const DEMO_VISITOR_HEADER = "x-michael-demo-visitor";

/**
 * The header the web app adds (server to server, with the API key and the visitor header) for the
 * presenter: the value is DEMO_PRESENTER_KEY. It only ever widens a demo visitor by the connect
 * decision below; on its own, or with anything but the API key, it means nothing.
 */
export const DEMO_PRESENTER_HEADER = "x-michael-demo-presenter";

/** A random id the web app made for one visitor (a UUID), never anything meaningful. */
export const DemoVisitorId = z.uuid();

export const DEMO_VISITOR_MESSAGE = "This is the demo week. Sign in with Google to make it yours.";

// Writes a demo visitor may make: [method, path pattern]. Reads (GET, HEAD) are allowed.
const ALLOWED: [string, RegExp][] = [
  ["POST", /^\/v1\/chat(\/stream)?$/],
  // Their own threads (stored per visitor, like the lines in them).
  ["POST", /^\/v1\/chat\/threads$/],
  ["PATCH", /^\/v1\/chat\/threads\/[^/]+$/],
  ["DELETE", /^\/v1\/chat\/threads\/[^/]+$/],
  ["POST", /^\/v1\/recommendations\/[^/]+\/(execute|undo)$/],
  ["PATCH", /^\/v1\/recommendations\/[^/]+$/],
  // Book on Goals (#309): one undoable block on the user's own calendar, the same as Do it, and a
  // beat of the stage demo (docs/demo-runbook.md). Undo goes through the recommendation route.
  ["POST", /^\/v1\/goals\/[^/]+\/book$/],
  // The demo day can be edited on the Timeline (#271), like acting on a recommendation.
  ["POST", /^\/v1\/blocks$/],
  ["PATCH", /^\/v1\/blocks\/[^/]+$/],
  ["DELETE", /^\/v1\/blocks\/[^/]+$/],
  // The stage path (/auth/demo) shows the daily ritual and logging done time (#318, #317): saving
  // the ritual, logging time, settling a block and undoing a log. Reversible, and the demo reseed
  // puts the ritual and the logged entries back to the plan.
  ["POST", /^\/v1\/ritual\/(morning|evening)$/],
  ["POST", /^\/v1\/ritual\/(morning|evening)\/skip$/],
  ["POST", /^\/v1\/log(\/block)?$/],
  ["DELETE", /^\/v1\/log\/[^/]+$/],
  ["POST", /^\/v1\/analysis\/run$/],
  ["POST", /^\/v1\/travel\/plan$/],
  ["POST", /^\/v1\/focus-guards\/suggest$/],
  // "Seen" on a personal record card, so it is not announced again.
  ["POST", /^\/v1\/records\/[^/]+\/announced$/],
  // Michael reading his reply aloud (no state).
  ["POST", /^\/v1\/voice\/speak$/],
  // Speech to text for the visitor's own words (no state, audio never stored).
  ["POST", /^\/v1\/voice\/transcribe$/],
  ["POST", /^\/v1\/push\/subscriptions$/],
  ["DELETE", /^\/v1\/push\/subscriptions$/],
  ["POST", /^\/v1\/nudges\/test$/],
];

// What the presenter may do on top: answer the claude.ai consent, which connects Claude to the demo
// account with write access, and switch Off the record on and off for the privacy beat of the pitch
// (docs/pitch.md; the reseed turns it off again). Everything else stays as for any visitor.
const PRESENTER_ALLOWED: [string, RegExp][] = [
  ["POST", /^\/v1\/connect\/requests\/[^/]+$/],
  ["PUT", /^\/v1\/privacy\/off-the-record$/],
];

// Never for a visitor, not even to read: device keys, ingest and MCP belong to real callers.
const NEVER: RegExp[] = [/^\/mcp$/, /^\/v1\/webhooks(\/|$)/, /^\/v1\/tokens(\/|$)/];

/**
 * True when a demo visitor (or, with `presenter`, the presenter) may make this request. Unknown
 * writes are refused (fail closed).
 */
export function demoVisitorMay(method: string, path: string, presenter = false): boolean {
  const p = path.replace(/\/+$/, "") || "/";
  if (NEVER.some((r) => r.test(p))) return false;
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  const allowed = presenter ? [...ALLOWED, ...PRESENTER_ALLOWED] : ALLOWED;
  return allowed.some(([am, r]) => am === m && r.test(p));
}
