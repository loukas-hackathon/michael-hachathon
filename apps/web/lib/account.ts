import "server-only";
import { cookies } from "next/headers";
import { authEnabled, DEMO_COOKIE, supabaseServer } from "./supabase/server";

/** Who is signed in, in words for the Account section. */
export async function signedInAs(): Promise<string> {
  if (!authEnabled) return "Local preview, no sign in";
  if ((await cookies()).get(DEMO_COOKIE)?.value === "1") return "The demo week";
  try {
    // Verified locally from the session JWT (no Auth round trip); the email is one of its claims.
    const { data } = await (await supabaseServer()).auth.getClaims();
    return data?.claims?.email ?? "Signed in";
  } catch {
    return "Signed in";
  }
}
