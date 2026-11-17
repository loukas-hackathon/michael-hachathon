import { type NextRequest, NextResponse } from "next/server";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";
import { publicUrl } from "@/lib/public-origin";
import { DEMO_COOKIE, supabaseServer } from "@/lib/supabase/server";

// Google sends the user back here with a one time code; swap it for a session cookie.
// Anything else (cancelled at Google, expired code, no code) goes back to /login with a reason
// the login page turns into one line of copy. A signed out visit to a page (above all the Claude
// consent page, /connect) left its path in NEXT_COOKIE; success goes back there.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const oauthError = params.get("error");

  const fail = (reason: "cancelled" | "failed") => {
    const login = publicUrl("/login", request);
    login.searchParams.set("error", reason);
    return NextResponse.redirect(login);
  };

  if (oauthError) return fail(oauthError === "access_denied" ? "cancelled" : "failed");
  if (!code) return fail("failed");

  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("failed");
  } catch {
    return fail("failed");
  }

  const next = safeNext(request.cookies.get(NEXT_COOKIE)?.value) ?? "/";
  const response = NextResponse.redirect(publicUrl(next, request));
  response.cookies.delete(DEMO_COOKIE);
  response.cookies.delete(NEXT_COOKIE);
  return response;
}
