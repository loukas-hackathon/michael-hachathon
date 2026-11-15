import { type NextRequest, NextResponse } from "next/server";
import { DEMO_COOKIE, demoVisitorId } from "@/lib/auth-mode";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";
import { authEnabled, supabaseServer } from "@/lib/supabase/server";

// "See the demo week": browse the demo account without signing in. Each visitor gets an anonymous
// id (a random UUID in an httpOnly cookie) that the server sends to the API with the API key, so
// visitors never see each other's chat and cannot change the shared week.
// Signed in, this signs out first: a session always wins over the demo cookie, so the two never mix.
export async function GET(request: NextRequest) {
  if (authEnabled) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    if (data.user) await supabase.auth.signOut();
  }
  const response = NextResponse.redirect(
    new URL(safeNext(request.nextUrl.searchParams.get("next")) ?? "/", request.url),
  );
  // Coming back keeps the same visitor (and their chat); a new visitor gets a new id.
  const visitor = demoVisitorId(request.cookies.get(DEMO_COOKIE)?.value) ?? crypto.randomUUID();
  response.cookies.set(DEMO_COOKIE, visitor, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  // The way back was used (the Claude consent page, from the login page's link): spent.
  response.cookies.delete(NEXT_COOKIE);
  return response;
}
