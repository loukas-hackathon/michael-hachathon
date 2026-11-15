"use client";

import { useEffect } from "react";

// Keeps the Supabase session fresh in the background, so coming back to the app after an hour
// rarely waits for a token refresh (#449). The access token lives an hour; while the app is open
// this asks /auth/refresh every 5 minutes, and once more the moment it comes back to the front,
// which renews it whenever it has under 15 minutes left. No supabase-js in the bundle for it.
const EVERY_MS = 5 * 60 * 1000;
// Supabase's cookie (readable by design), or its chunks: only signed in visitors ask.
const SESSION_COOKIE = /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/;

export function SessionFresh() {
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || !SESSION_COOKIE.test(document.cookie)) return;
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
    };
  }, []);
  return null;
}
