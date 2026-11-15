import { authEnabled, supabaseServer } from "@/lib/supabase/server";

// Refresh a session before it runs out, well ahead of the 90 s margin the proxy refreshes in.
const AHEAD_MS = 15 * 60 * 1000;
const NO_STORE = { "cache-control": "no-store" };

// POST /auth/refresh: components/session-fresh.tsx calls it while the app is open and when it comes
// back to the front, so the session is already fresh when the next navigation arrives and the proxy
// rarely has to refresh while a screen waits. Always 204: nothing to show, nothing to fail loudly.
export async function POST() {
  if (!authEnabled) return new Response(null, { status: 204, headers: NO_STORE });
  try {
    const auth = (await supabaseServer()).auth;
    // Reads the cookie the proxy may just have refreshed; it does not refresh a second time.
    const { data } = await auth.getSession();
    const expiresAt = data.session?.expires_at;
    if (expiresAt && expiresAt * 1000 - Date.now() < AHEAD_MS) await auth.refreshSession();
  } catch (err) {
    console.error(`[auth] background refresh failed: ${(err as Error).message}`);
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
