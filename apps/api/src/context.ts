import { AsyncLocalStorage } from "node:async_hooks";

// Who the current request acts for. Set once by the auth middleware; the store reads it, so
// routes and MCP tools never pass user ids around and can't forget to scope a query.
// How the caller proved who they are. Only a signed-in session may manage credentials.
export type AuthMethod = "session" | "personal_token" | "mcp_oauth" | "api_key" | "script";

const requestUser = new AsyncLocalStorage<{ userId: string; via: AuthMethod }>();

export const runAsUser = <T>(userId: string, fn: () => T, via: AuthMethod = "script"): T =>
  requestUser.run({ userId, via }, fn);

export const currentAuthMethod = (): AuthMethod | null => requestUser.getStore()?.via ?? null;

export function currentUserId(): string {
  const ctx = requestUser.getStore();
  if (!ctx) throw new Error("No user in context: the route is missing the auth middleware");
  return ctx.userId;
}
