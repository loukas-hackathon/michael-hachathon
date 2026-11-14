import { type NextRequest, NextResponse } from "next/server";
import { safeNext } from "@/lib/next-path";
import { DEMO_COOKIE } from "@/lib/supabase/server";

// "Try the demo week": browse the demo account without signing in (the API key acts for it).
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL(safeNext(request.nextUrl.searchParams.get("next")) ?? "/", request.url),
  );
  response.cookies.set(DEMO_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return response;
}
