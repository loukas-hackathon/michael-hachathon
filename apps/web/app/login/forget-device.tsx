"use client";

import { useEffect } from "react";

// Supabase's cookie (readable by design), or its chunks: the same test as components/session-fresh.
const SESSION_COOKIE = /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/;
// What Michael keeps in the browser for one person: chat steps, the off the record copy, hints.
const OURS = /^(michael|m-)/;

/**
 * Signed out on /login: nothing of the previous account stays on this device (#459). Clears this
 * tab's session storage (chat steps, the splash flag), Michael's local storage, and whatever the
 * service worker holds in memory. The worker's caches only hold the public shell, so they stay and
 * the next sign in still starts fast.
 */
export function ForgetDevice() {
  useEffect(() => {
    if (SESSION_COOKIE.test(document.cookie)) return; // signed in, just looking at /login
    try {
      sessionStorage.clear();
    } catch {}
    try {
      for (const key of Object.keys(localStorage)) if (OURS.test(key)) localStorage.removeItem(key);
    } catch {}
    navigator.serviceWorker?.controller?.postMessage({ type: "forget" });
  }, []);
  return null;
}
