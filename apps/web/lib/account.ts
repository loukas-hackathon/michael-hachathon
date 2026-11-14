import "server-only";
import { cookies } from "next/headers";
import { authEnabled, DEMO_COOKIE, supabaseServer } from "./supabase/server";

/** Who is signed in, in words for the Account section. */
export async function signedInAs(): Promise<string> {
  if (!authEnabled) return "Local preview, no sign in";
  if ((await cookies()).get(DEMO_COOKIE)?.value === "1") return "The demo week";
  try {
    const { data } = await (await supabaseServer()).auth.getUser();
    return data.user?.email ?? "Signed in";
  } catch {
    return "Signed in";
  }
}
