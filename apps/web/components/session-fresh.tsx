"use client";

import { useEffect } from "react";

// Keeps the Supabase session fresh in the background, so coming back to the app after an hour
// rarely waits for a token refresh (#449). The access token lives an hour; while the app is open
// this asks /auth/refresh every 5 minutes, and once more shortly after it comes back to the front,
// which renews it whenever it has under 15 minutes left. It reads the expiry from the cookie first,
// so a fresh session costs no request at all. No supabase-js in the bundle for it.
const EVERY_MS = 5 * 60 * 1000;
// Supabase's cookie (readable by design), or its chunks: only signed in visitors ask.
const SESSION_COOKIE = /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/;
// The end to end tests' sign in (lib/auth-mode.ts), readable like Supabase's.
const TEST_COOKIE = /(?:^|;\s*)michael_e2e_user=/;
const hasSession = () => SESSION_COOKIE.test(document.cookie) || TEST_COOKIE.test(document.cookie);
// /auth/refresh renews a session with under 15 minutes left; with more there is nothing to ask.
const AHEAD_MS = 15 * 60 * 1000;
// Coming back to the front, the screen's own refresh goes first (components/stale-screen.tsx): it
// renews an expired session in the proxy on the way. This asks only after it, and only if that did
// not already renew it, so no tap ever queues behind a second refresh (#502).
const AFTER_RESUME_MS = 3000;

/** When the session cookie runs out (ms), or null when it cannot be read (then ask anyway). */
function sessionExpiresAt(): number | null {
  try {
    const parts = document.cookie
      .split(/;\s*/)
      .map((c) => c.match(/^sb-[^=]+-auth-token(?:\.(\d+))?=(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .sort((a, b) => Number(a[1] ?? 0) - Number(b[1] ?? 0));
    if (!parts.length) return null;
    let value = decodeURIComponent(parts.map((m) => m[2]).join(""));
    if (value.startsWith("base64-")) {
      value = atob(value.slice(7).replace(/-/g, "+").replace(/_/g, "/"));
    }
    const at = Number(JSON.parse(value).expires_at);
    return at > 0 ? at * 1000 : null;
  } catch {
    return null;
  }
}

export function SessionFresh() {
  useEffect(() => {
    let last = Date.now();
    // Signed in when this page was drawn. If the session has gone since (Sign out, then Back, which
    // Safari serves from its page cache), the old account must not stay on screen (#459).
    const drawnSignedIn = hasSession();
    const gone = () => drawnSignedIn && !hasSession();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && gone()) location.replace("/login");
    };
    window.addEventListener("pageshow", onPageShow);
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (gone()) {
        // Signed out in another tab: nothing to refresh, and this screen belongs to nobody now.
        location.replace("/login");
        return;
      }
      if (!SESSION_COOKIE.test(document.cookie)) return;
      last = Date.now();
      const expiresAt = sessionExpiresAt();
      if (expiresAt && expiresAt - Date.now() > AHEAD_MS) return; // still fresh: no round trip
      fetch("/auth/refresh", { method: "POST", cache: "no-store" }).catch(() => {});
    };
    const id = setInterval(() => {
      if (Date.now() - last >= EVERY_MS) refresh();
    }, 60 * 1000);
    let resume: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      clearTimeout(resume);
      if (document.visibilityState !== "visible") return;
      if (gone()) {
        location.replace("/login");
        return;
      }
      resume = setTimeout(refresh, AFTER_RESUME_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      clearTimeout(resume);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}
