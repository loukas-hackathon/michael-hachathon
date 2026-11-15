"use client";

import { useEffect } from "react";

// Keeps the Supabase session fresh in the background, so coming back to the app after an hour
// rarely waits for a token refresh (#449). The access token lives an hour; while the app is open
// this asks /auth/refresh every 5 minutes, and once more the moment it comes back to the front,
// which renews it whenever it has under 15 minutes left. No supabase-js in the bundle for it.
const EVERY_MS = 5 * 60 * 1000;
// Supabase's cookie (readable by design), or its chunks: only signed in visitors ask.
const SESSION_COOKIE = /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/;
// The end to end tests' sign in (lib/auth-mode.ts), readable like Supabase's.
const TEST_COOKIE = /(?:^|;\s*)michael_e2e_user=/;
const hasSession = () => SESSION_COOKIE.test(document.cookie) || TEST_COOKIE.test(document.cookie);

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
      fetch("/auth/refresh", { method: "POST", cache: "no-store" }).catch(() => {});
    };
    const id = setInterval(() => {
      if (Date.now() - last >= EVERY_MS) refresh();
    }, 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}
