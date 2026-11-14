import { type NextRequest, NextResponse } from "next/server";
import { DEMO_COOKIE, supabaseServer } from "@/lib/supabase/server";

// Google sends the user back here with a one time code; swap it for a session cookie.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const target = new URL("/", request.url);
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) target.pathname = "/login";
  }
  const response = NextResponse.redirect(target);
  response.cookies.delete(DEMO_COOKIE);
  return response;
}
