import { type NextRequest, NextResponse } from "next/server";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";
import { authEnabled, DEMO_COOKIE, supabaseServer } from "@/lib/supabase/server";

// Signs out and goes to /login. With ?next= (the Claude consent page, when its session turned out
// dead), the way back rides in NEXT_COOKIE like any signed out visit, so Google returns there.
export async function GET(request: NextRequest) {
  if (authEnabled) {
    try {
      // Clears the cookies even when Auth no longer knows the user (a deleted account).
      await (await supabaseServer()).auth.signOut();
    } catch (err) {
      console.error(`[auth] sign out failed: ${(err as Error).message}`);
    }
  }
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const login = new URL("/login", request.url);
  if (next) login.searchParams.set("next", next);
  const response = NextResponse.redirect(login);
  response.cookies.delete(DEMO_COOKIE);
  if (next) {
    response.cookies.set(NEXT_COOKIE, next, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 30 * 60,
    });
  }
  return response;
}
