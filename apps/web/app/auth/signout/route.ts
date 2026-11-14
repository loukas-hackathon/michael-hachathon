import { type NextRequest, NextResponse } from "next/server";
import { authEnabled, DEMO_COOKIE, supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  if (authEnabled) await (await supabaseServer()).auth.signOut();
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(DEMO_COOKIE);
  return response;
}
