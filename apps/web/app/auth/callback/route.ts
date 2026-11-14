import { type NextRequest, NextResponse } from "next/server";
import { DEMO_COOKIE, supabaseServer } from "@/lib/supabase/server";

// Google sends the user back here with a one time code; swap it for a session cookie.
// Anything else (cancelled at Google, expired code, no code) goes back to /login with a reason
// the login page turns into one line of copy.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const oauthError = params.get("error");

  const fail = (reason: "cancelled" | "failed") => {
    const login = new URL("/login", request.url);
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

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.delete(DEMO_COOKIE);
  return response;
}
