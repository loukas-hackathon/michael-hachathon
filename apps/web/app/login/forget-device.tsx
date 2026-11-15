"use client";

import { useEffect } from "react";
import { INSTALL_DISMISSED_KEY } from "@/lib/install-platform";

// Supabase's cookie (readable by design), or its chunks: the same test as components/session-fresh.
const SESSION_COOKIE = /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/;
// What Michael keeps in the browser for one person: chat steps, the off the record copy, hints.
const OURS = /^(michael|m-)/;
// What it keeps about the device, whoever signs in: "Don't show this again" on Get the app (#460),
// and that the Michael Focus shortcut was added here (#447). Signing out forgets a person, not these.
const DEVICE: ReadonlySet<string> = new Set([INSTALL_DISMISSED_KEY, "michael-focus-shortcut"]);

/**
 * Signed out on /login: nothing of the previous account stays on this device (#459). Clears this
 * tab's session storage (chat steps, the splash flag), Michael's local storage for that person, and whatever the
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
      for (const key of Object.keys(localStorage)) {
        if (OURS.test(key) && !DEVICE.has(key)) localStorage.removeItem(key);
      }
    } catch {}
    navigator.serviceWorker?.controller?.postMessage({ type: "forget" });
  }, []);
  return null;
}
