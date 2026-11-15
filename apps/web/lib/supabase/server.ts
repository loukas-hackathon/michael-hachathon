import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const authEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// "See the demo week" (one anonymous visitor id): lib/auth-mode.ts.
export { DEMO_COOKIE } from "../auth-mode";

// Supabase client bound to the request cookies (Server Components, Route Handlers, Server Actions).
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read only; the proxy refreshes them.
        }
      },
    },
  });
}

/**
 * True when this session came from email and password (#475), not Google. Onboarding then offers
 * Google Calendar as a Connect step instead of jumping to Google's consent: in the installed iPhone
 * app that jump leaves the app. Reads the JWT locally (getClaims), no round trip.
 */
export async function signedInWithEmail(): Promise<boolean> {
  if (!authEnabled) return false;
  try {
    const { data } = await (await supabaseServer()).auth.getClaims();
    const meta = data?.claims?.app_metadata as { provider?: unknown } | undefined;
    return meta?.provider === "email";
  } catch {
    return false;
  }
}
