import { type NextRequest, NextResponse } from "next/server";
import { E2E_COOKIE } from "@/lib/auth-mode";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";
import { PRESENTER_COOKIE } from "@/lib/presenter";
import { publicUrl } from "@/lib/public-origin";
import { authEnabled, DEMO_COOKIE, supabaseServer } from "@/lib/supabase/server";

// Sign out never waits longer than this on Supabase: the cookies go regardless (#459).
const REVOKE_WAIT_MS = 1500;
// Supabase's session cookie and its chunks (.0, .1), and the PKCE verifier of a sign in left halfway.
const SUPABASE_COOKIE = /^sb-.+-auth-token/;

// Signs out and goes to /login. With ?next= (the Claude consent page, when its session turned out
// dead), the way back rides in NEXT_COOKIE like any signed out visit, so Google returns there.
export async function GET(request: NextRequest) {
  if (authEnabled) {
    try {
      // This device only: signing out on the phone must not sign out the laptop on stage.
      // Clears the cookies even when Auth no longer knows the user (a deleted account).
      const auth = (await supabaseServer()).auth;
      await Promise.race([
        auth.signOut({ scope: "local" }),
        new Promise((resolve) => setTimeout(resolve, REVOKE_WAIT_MS)),
      ]);
    } catch (err) {
      console.error(`[auth] sign out failed: ${(err as Error).message}`);
    }
  }
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const login = publicUrl("/login", request);
  if (next) login.searchParams.set("next", next);
  const response = NextResponse.redirect(login, 303);
  response.headers.set("cache-control", "no-store");
  // Nothing of the old account survives, even if Supabase was slow to answer above.
  for (const { name } of request.cookies.getAll()) {
    if (SUPABASE_COOKIE.test(name)) response.cookies.delete(name);
  }
  response.cookies.delete(DEMO_COOKIE);
  response.cookies.delete(PRESENTER_COOKIE);
  response.cookies.delete(E2E_COOKIE);
  if (next) {
    response.cookies.set(NEXT_COOKIE, next, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 30 * 60,
    });
  } else response.cookies.delete(NEXT_COOKIE);
  return response;
}
