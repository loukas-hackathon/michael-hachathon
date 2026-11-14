import "server-only";
import { isDemoVisitor } from "./caller";
import { authEnabled, supabaseServer } from "./supabase/server";

/** Who is signed in, in words for the Account section. A session wins over the demo cookie. */
export async function signedInAs(): Promise<string> {
  if (!authEnabled) return "Local preview, no sign in";
  try {
    // Verified locally from the session JWT (no Auth round trip); the email is one of its claims.
    const { data } = await (await supabaseServer()).auth.getClaims();
    if (data?.claims?.sub) return data.claims.email ?? "Signed in";
  } catch {
    // Fall through: the demo check below never throws.
  }
  return (await isDemoVisitor()) ? "The demo week" : "Signed in";
}
