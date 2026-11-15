"use client";

import { useCallback, useEffect, useState } from "react";
import { registerServiceWorker } from "@/components/service-worker";
import { readPushConfig, savePushSubscription } from "./push-actions";

// Nudges on this device (Web Push), shared by You's button, the end of onboarding and the ask after
// the first Do it. Reading the state never asks for anything: the system prompt only ever comes from
// a tap on "Turn on nudges". On iPhone, web push only works in Michael on the Home Screen (iOS 16.4+).

export type NudgeState =
  | { kind: "loading" }
  | { kind: "install" } // iPhone in Safari: add to Home Screen first
  | { kind: "unsupported" }
  | { kind: "unavailable" } // the API has no push keys yet
  | { kind: "denied" }
  | { kind: "off"; key: string }
  | { kind: "working"; key: string }
  | { kind: "on" };

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Reads this device's nudge state once (when `active`), and turns nudges on from a tap. */
export function useNudges(active = true) {
  const [state, setState] = useState<NudgeState>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const set = (s: NudgeState) => !cancelled && setState(s);
    (async () => {
      // Safari on iPhone only offers push to the Home Screen app, so say that before anything else.
      if (isIOS() && !isStandalone()) return set({ kind: "install" });
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return set({ kind: "unsupported" });
      }
      const [config, registration] = await Promise.all([readPushConfig(), registerServiceWorker()]);
      if (!config.enabled || !config.public_key) return set({ kind: "unavailable" });
      if (Notification.permission === "denied") return set({ kind: "denied" });
      const existing = await registration.pushManager.getSubscription();
      if (existing && Notification.permission === "granted") {
        // Save again: keeps the device tied to whoever is signed in now.
        await savePushSubscription(existing.toJSON());
        return set({ kind: "on" });
      }
      set({ kind: "off", key: config.public_key });
    })().catch(() => set({ kind: "unavailable" }));
    return () => {
      cancelled = true;
    };
  }, [active]);

  const turnOn = useCallback(async () => {
    if (state.kind !== "off") return;
    const key = state.key;
    setError(null);
    setState({ kind: "working", key });
    try {
      // Ask first, straight from the tap: iOS only shows the prompt for a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? { kind: "denied" } : { kind: "off", key });
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(key),
        }));
      await savePushSubscription(sub.toJSON());
      setState({ kind: "on" });
    } catch {
      setError("I could not turn nudges on. Try again.");
      setState({ kind: "off", key });
    }
  }, [state]);

  return { state, turnOn, error };
}

// "Not now" is remembered on this device for three days, so the ask after a Do it never nags.
const ASKED_KEY = "michael_nudges_asked";
const QUIET_FOR = 3 * 24 * 60 * 60 * 1000;

export function recentlyAsked(): boolean {
  try {
    const at = Number(localStorage.getItem(ASKED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < QUIET_FOR;
  } catch {
    return false;
  }
}

export function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch {
    // Private mode: the ask may come back sooner, which is harmless.
  }
}
