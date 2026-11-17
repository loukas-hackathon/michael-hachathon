import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentClient } from "@michael/shared";

// Who the current request acts for. Set once by the auth middleware; the store reads it, so
// routes and MCP tools never pass user ids around and can't forget to scope a query.
// How the caller proved who they are. Only a signed-in session may manage credentials.
// `demo_visitor`: the web app browsing the shared demo week for one anonymous visitor (the API key
// plus X-Michael-Demo-Visitor). Read mostly: demo/visitor.ts says what such a caller may change.
export type AuthMethod = "session" | "personal_token" | "mcp_oauth" | "api_key" | "demo_visitor" | "script";

interface RequestUser {
  userId: string;
  via: AuthMethod;
  agent?: AgentClient;
  /** The anonymous demo visitor, only with `via: "demo_visitor"`. Scopes the demo chat. */
  visitor?: string;
  /** The signed-in session's email (lowercased), when the sign in carries one. Only for admin checks. */
  email?: string;
}

const requestUser = new AsyncLocalStorage<RequestUser>();

/** `agent` is set when an agent (an OAuth MCP client) acts for the user: scopes and the query log. */
export const runAsUser = <T>(
  userId: string,
  fn: () => T,
  via: AuthMethod = "script",
  agent?: AgentClient,
  visitor?: string,
  email?: string,
): T => requestUser.run({ userId, via, agent, visitor, email }, fn);

export const currentAuthMethod = (): AuthMethod | null => requestUser.getStore()?.via ?? null;

export const currentAgent = (): AgentClient | null => requestUser.getStore()?.agent ?? null;

/** The demo visitor this request is for, or null for everyone else (their own account). */
/** The email of a signed-in session (never of a key or an agent), lowercased; null otherwise. */
export const currentSessionEmail = (): string | null => {
  const ctx = requestUser.getStore();
  return ctx?.via === "session" && ctx.email ? ctx.email : null;
};

export const currentDemoVisitor = (): string | null => requestUser.getStore()?.visitor ?? null;

export function currentUserId(): string {
  const ctx = requestUser.getStore();
  if (!ctx) throw new Error("No user in context: the route is missing the auth middleware");
  return ctx.userId;
}
