import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { AUTH_MISSING_MESSAGE, DEMO_COOKIE, demoVisitorId, localFallbackAllowed } from "./auth-mode";
import { authEnabled, supabaseServer } from "./supabase/server";

// Who the web app asks the API for. One rule, in this order:
// 1. a signed in Supabase session: that user's own token, always (a demo cookie is ignored);
// 2. the demo cookie: the API key plus the visitor id, so the API knows it is one anonymous demo
//    visitor (read mostly, a chat of their own);
// 3. no auth env on a developer's machine: the API key (the demo account); on a deployment this
//    fails closed instead.
// The browser never sees API_KEY.

const API_KEY = process.env.API_KEY ?? "dev-key";

/** Must match apps/api/src/demo/visitor.ts. */
const DEMO_VISITOR_HEADER = "x-michael-demo-visitor";

export type Caller =
  | { kind: "session"; token: string }
  | { kind: "demo"; visitor: string }
  | { kind: "local" };

/** Resolved once per server render (React cache), however many loaders ask. */
export const currentCaller = cache(async (): Promise<Caller> => {
  if (!authEnabled) {
    if (!localFallbackAllowed()) throw new Error(AUTH_MISSING_MESSAGE);
    return { kind: "local" };
  }
  const { data } = await (await supabaseServer()).auth.getSession();
  if (data.session) return { kind: "session", token: data.session.access_token };
  const visitor = demoVisitorId((await cookies()).get(DEMO_COOKIE)?.value);
  if (visitor) return { kind: "demo", visitor };
  throw new Error("Not signed in");
});

/** The headers every API call carries. Throws when nobody is signed in. */
export async function authHeaders(): Promise<Record<string, string>> {
  const caller = await currentCaller();
  if (caller.kind === "session") return { authorization: `Bearer ${caller.token}` };
  if (caller.kind === "demo")
    return { authorization: `Bearer ${API_KEY}`, [DEMO_VISITOR_HEADER]: caller.visitor };
  return { authorization: `Bearer ${API_KEY}` };
}

/** True when this request browses the demo week (no session, a demo cookie). Never throws. */
export async function isDemoVisitor(): Promise<boolean> {
  try {
    return (await currentCaller()).kind === "demo";
  } catch {
    return false;
  }
}
