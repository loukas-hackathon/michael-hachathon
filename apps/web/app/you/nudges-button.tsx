"use client";

import { useEffect, useRef, useState } from "react";
import { useArriveConnection } from "@/components/you/connections-live";
import { sendTestNudge } from "@/lib/push-actions";
import { type NudgeState, useNudges } from "@/lib/use-nudges";

// "Turn on nudges": one tap asks for notifications, subscribes this device to Web Push and saves it
// for the signed-in user (lib/use-nudges.ts). On iPhone this only works in Michael on the Home
// Screen (iOS 16.4+), and the nudge then mirrors to the Apple Watch.

export function NudgesButton() {
  const { state, turnOn, error } = useNudges();
  const [note, setNote] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  // Allowed and saved: the Nudges row and this page say Connected at once (#466).
  const arrive = useArriveConnection("nudges");
  const was = useRef(state.kind);
  useEffect(() => {
    if (was.current === "working" && state.kind === "on") arrive();
    was.current = state.kind;
  }, [state.kind, arrive]);

  async function test() {
    setTesting(true);
    setNote(null);
    try {
      const r = await sendTestNudge();
      setNote(r.delivered > 0 ? `Sent: "${r.text}"` : "No device took it. Turn nudges on again.");
    } catch {
      setNote("I couldn't send that. Try again.");
    } finally {
      setTesting(false);
    }
  }

  const footnote: Record<NudgeState["kind"], string> = {
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
            onClick={turnOn}
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
      <p className="mt-2 px-4 text-footnote text-label-2">{note ?? error ?? footnote[state.kind]}</p>
    </>
  );
}
