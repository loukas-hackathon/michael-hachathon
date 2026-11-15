"use client";

import { useState } from "react";
import { markAsked, recentlyAsked, useNudges } from "@/lib/use-nudges";

// The ask for nudges, at the moment they help (#207): after the first Do it on Today. A primer comes
// before the system prompt, so "Not now" never spends it. On iPhone in Safari it shows the two
// Home Screen steps first, because iOS only allows web push from there.

/** The Home Screen steps, as iPhone shows them. */
export function InstallSteps() {
  const steps = [
    <>
      Tap <span className="font-semibold text-label">Share</span> at the bottom of Safari.
    </>,
    <>
      Tap <span className="font-semibold text-label">Add to Home Screen</span>.
    </>,
    <>Open Michael from your Home Screen. I ask once, from there.</>,
  ];
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed list of steps
        <li key={i} className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-full bg-label text-footnote font-semibold text-bg tnum"
          >
            {i + 1}
          </span>
          <span className="pt-0.5 text-subhead text-label-2">{s}</span>
        </li>
      ))}
    </ol>
  );
}

const filled =
  "hit press min-h-9 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint disabled:opacity-60";
const plain = "hit press min-h-9 rounded-full px-3 text-subhead font-semibold text-label-2";

/**
 * "Want a buzz when the block starts?" under the suggestion that was just done. Renders nothing when
 * nudges are on, cannot work here, or the person said Not now in the last three days.
 */
export function NudgePrimer() {
  const [skipped] = useState(recentlyAsked);
  const [closed, setClosed] = useState(false);
  const { state, turnOn, error } = useNudges(!skipped);
  const [turnedOn, setTurnedOn] = useState(false);

  if (skipped || closed) return null;
  if (state.kind === "on" && !turnedOn) return null;
  if (!["install", "off", "working", "on", "denied"].includes(state.kind)) return null;

  const later = () => {
    markAsked();
    setClosed(true);
  };

  return (
    <section aria-label="Nudges" className="mt-2.5 rounded-group bg-fill px-4 pt-3 pb-3.5" aria-live="polite">
      {state.kind === "on" ? (
        <p className="text-body font-semibold">Nudges are on. I buzz when the block starts.</p>
      ) : state.kind === "denied" ? (
        <>
          <p className="text-body font-semibold">Notifications are off for Michael.</p>
          <p className="mt-1 text-subhead text-label-2">Turn them on in Settings, Notifications, Michael.</p>
        </>
      ) : state.kind === "install" ? (
        <>
          <p className="text-body font-semibold">Want a buzz when the block starts?</p>
          <p className="mt-1 mb-3 text-subhead text-label-2">
            On iPhone, nudges only work with Michael on your Home Screen. Two taps.
          </p>
          <InstallSteps />
          <div className="mt-3 flex justify-end">
            <button type="button" className={plain} onClick={later}>
              Got it
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body font-semibold">Want a buzz when the block starts?</p>
          <p className="mt-1 text-subhead text-label-2">
            At most five a day, never in quiet hours. Your Apple Watch buzzes too.
          </p>
          {error ? (
            <p role="alert" className="mt-1 text-subhead text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={filled}
              disabled={state.kind === "working"}
              onClick={async () => {
                await turnOn();
                setTurnedOn(true);
              }}
            >
              {state.kind === "working" ? "Asking your phone" : "Turn on nudges"}
            </button>
            <button type="button" className={plain} onClick={later}>
              Not now
            </button>
          </div>
        </>
      )}
    </section>
  );
}
