import { type NextRequest, NextResponse } from "next/server";
import { DEMO_COOKIE, demoVisitorId } from "@/lib/auth-mode";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";
import {
  PRESENTER_COOKIE,
  PRESENTER_MAX_AGE_S,
  presenterCookieValue,
  presenterKeyMatches,
  presenterTryAllowed,
} from "@/lib/presenter";
import { authEnabled, supabaseServer } from "@/lib/supabase/server";

// The presenter link (#343): /auth/presenter?key=<DEMO_PRESENTER_KEY>, opened once on the laptop
// that presents. It browses the demo week like "See the demo week" and may also tap Allow when
// claude.ai connects (lib/presenter.ts). A wrong or missing key, or too many tries, is just a demo
// visitor: nothing says whether the key was close.
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ok = presenterTryAllowed(address) && presenterKeyMatches(request.nextUrl.searchParams.get("key"));

  if (!ok) {
    const demo = new URL("/auth/demo", request.url);
    if (next) demo.searchParams.set("next", next);
    const response = NextResponse.redirect(demo);
    response.cookies.delete(PRESENTER_COOKIE);
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  }

  // As /auth/demo: a session always wins over the demo week, so sign it out first.
  if (authEnabled) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    if (data.user) await supabase.auth.signOut();
  }
  const response = NextResponse.redirect(new URL(next ?? "/", request.url));
  // The key was in the address: never pass it on as a referrer.
  response.headers.set("referrer-policy", "no-referrer");
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: PRESENTER_MAX_AGE_S,
  };
  // The presenter is a demo visitor (their own chat) for as long as the presenter cookie lasts.
  const visitor = demoVisitorId(request.cookies.get(DEMO_COOKIE)?.value) ?? crypto.randomUUID();
  response.cookies.set(DEMO_COOKIE, visitor, cookie);
  response.cookies.set(PRESENTER_COOKIE, presenterCookieValue(), cookie);
  response.cookies.delete(NEXT_COOKIE);
  return response;
}
