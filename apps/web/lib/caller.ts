import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  AUTH_MISSING_MESSAGE,
  DEMO_COOKIE,
  demoVisitorId,
  E2E_COOKIE,
  e2eTestUser,
  localFallbackAllowed,
} from "./auth-mode";
import { PRESENTER_COOKIE, presenterKey, validPresenterCookie } from "./presenter";
import { authEnabled, supabaseServer } from "./supabase/server";

// Who the web app asks the API for. One rule, in this order:
// 1. a signed in Supabase session: that user's own token, always (a demo cookie is ignored);
// 2. the demo cookie: the API key plus the visitor id, so the API knows it is one anonymous demo
//    visitor (read mostly, a chat of their own); with a valid presenter cookie also the presenter
//    key, so the API lets that one browser answer the claude.ai consent (lib/presenter.ts);
// 3. no auth env on a developer's machine: the API key (the demo account); on a deployment this
//    fails closed instead.
// The browser never sees API_KEY.

const API_KEY = process.env.API_KEY ?? "dev-key";

/** Must match apps/api/src/demo/visitor.ts. */
const DEMO_VISITOR_HEADER = "x-michael-demo-visitor";
const DEMO_PRESENTER_HEADER = "x-michael-demo-presenter";

export type Caller =
  | { kind: "session"; token: string }
  | { kind: "demo"; visitor: string; presenter: boolean }
  | { kind: "local" };

/**
 * Resolved once per server render (React cache), however many loaders ask, so Supabase getSession
 * runs once instead of once per API call. Outside a render (actions, route handlers) it is a no-op.
 */
export const currentCaller = cache(async (): Promise<Caller> => {
  // End-to-end tests only (see e2eTestUser): a fresh user without Supabase.
  const testUser = e2eTestUser((await cookies()).get(E2E_COOKIE)?.value);
  if (testUser) return { kind: "session", token: `e2e_${testUser}` };
  if (!authEnabled) {
    if (!localFallbackAllowed()) throw new Error(AUTH_MISSING_MESSAGE);
    return { kind: "local" };
  }
  const { data } = await (await supabaseServer()).auth.getSession();
  if (data.session) return { kind: "session", token: data.session.access_token };
  const jar = await cookies();
  const visitor = demoVisitorId(jar.get(DEMO_COOKIE)?.value);
  if (visitor)
    return { kind: "demo", visitor, presenter: validPresenterCookie(jar.get(PRESENTER_COOKIE)?.value) };
  throw new Error("Not signed in");
});

/** The headers every API call carries. Throws when nobody is signed in. */
export async function authHeaders(): Promise<Record<string, string>> {
  const caller = await currentCaller();
  if (caller.kind === "session") return { authorization: `Bearer ${caller.token}` };
  if (caller.kind === "demo") {
    const headers = { authorization: `Bearer ${API_KEY}`, [DEMO_VISITOR_HEADER]: caller.visitor };
    const key = caller.presenter ? presenterKey() : null;
    return key ? { ...headers, [DEMO_PRESENTER_HEADER]: key } : headers;
  }
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

/** True when this request is the presenter browsing the demo week (lib/presenter.ts). Never throws. */
export async function isPresenter(): Promise<boolean> {
  try {
    const caller = await currentCaller();
    return caller.kind === "demo" && caller.presenter;
  } catch {
    return false;
  }
}
