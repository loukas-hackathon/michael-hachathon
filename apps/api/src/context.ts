import { AsyncLocalStorage } from "node:async_hooks";

// Who the current request acts for. Set once by the auth middleware; the store reads it, so
// routes and MCP tools never pass user ids around and can't forget to scope a query.
const requestUser = new AsyncLocalStorage<{ userId: string }>();

export const runAsUser = <T>(userId: string, fn: () => T): T => requestUser.run({ userId }, fn);

export function currentUserId(): string {
  const ctx = requestUser.getStore();
  if (!ctx) throw new Error("No user in context: the route is missing the auth middleware");
  return ctx.userId;
}
