import { type NextRequest, NextResponse } from "next/server";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";
import { DEMO_COOKIE, supabaseServer } from "@/lib/supabase/server";

// Google sends the user back here with a one time code; swap it for a session cookie.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(decodeURIComponent(request.cookies.get(NEXT_COOKIE)?.value ?? ""));
  const target = new URL(next ?? "/", request.url);
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      target.pathname = "/login";
      target.search = "";
    }
  }
  const response = NextResponse.redirect(target);
  response.cookies.delete(DEMO_COOKIE);
  response.cookies.delete(NEXT_COOKIE);
  return response;
}
