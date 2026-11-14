"use client";

import { useEffect, useState } from "react";
import { readPushConfig, savePushSubscription, sendTestNudge } from "@/lib/push-actions";

// "Turn on nudges": one tap asks for notifications, subscribes this device to Web Push and saves it
// for the signed-in user. On iPhone this only works in Michael on the Home Screen (iOS 16.4+), and
// the nudge then mirrors to the Apple Watch.

type State =
  | { kind: "loading" }
  | { kind: "install" } // iPhone in Safari: add to Home Screen first
  | { kind: "unsupported" }
  | { kind: "unavailable" } // the API has no push keys yet
  | { kind: "denied" }
  | { kind: "off"; key: string }
  | { kind: "working" }
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

export function NudgesButton() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [note, setNote] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const set = (s: State) => !cancelled && setState(s);
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return set(isIOS() && !isStandalone() ? { kind: "install" } : { kind: "unsupported" });
      }
      const [config, registration] = await Promise.all([
        readPushConfig(),
        navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }),
      ]);
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
  }, []);

  async function turnOn(key: string) {
    setNote(null);
    setState({ kind: "working" });
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
      setNote("I could not turn nudges on. Try again.");
      setState({ kind: "off", key });
    }
  }

  async function test() {
    setTesting(true);
    setNote(null);
    try {
      const r = await sendTestNudge();
      setNote(r.delivered > 0 ? `Sent: "${r.text}"` : "No device took it. Turn nudges on again.");
    } catch {
      setNote("I could not send that. Try again.");
    } finally {
      setTesting(false);
    }
  }

  const footnote: Record<State["kind"], string> = {
    loading: "Checking this device.",
    install: "Add Michael to your Home Screen first: tap Share, then Add to Home Screen. Open it from there.",
    unsupported: "This browser cannot show nudges. Use Michael on your iPhone Home Screen.",
    unavailable: "Nudges are not ready on our side yet.",
    denied: "Notifications are off for Michael. Turn them on in Settings, Notifications, Michael.",
    off: "At most five a day, never in quiet hours. Your Apple Watch buzzes too.",
    working: "Asking your phone.",
    on: "Nudges are on for this device. Your Apple Watch buzzes too.",
  };

  return (
    <>
      <div className="overflow-hidden rounded-group bg-fill">
        {state.kind === "off" || state.kind === "working" ? (
          <button
            type="button"
            disabled={state.kind === "working"}
            onClick={() => state.kind === "off" && turnOn(state.key)}
            className="press flex h-12 w-full items-center justify-center bg-tint text-body font-semibold text-on-tint disabled:opacity-60"
          >
            Turn on nudges
          </button>
        ) : state.kind === "on" ? (
          <button
            type="button"
            disabled={testing}
            onClick={test}
            className="press flex min-h-12 w-full items-center justify-between px-4 text-body disabled:opacity-60"
          >
            <span>Nudges on</span>
            <span className="font-semibold text-tint-text">{testing ? "Sending" : "Send a test"}</span>
          </button>
        ) : (
          <p className="flex min-h-12 items-center px-4 text-body text-label-2">Nudges off</p>
        )}
      </div>
      <p className="mt-2 px-4 text-footnote text-label-2">{note ?? footnote[state.kind]}</p>
    </>
  );
}
