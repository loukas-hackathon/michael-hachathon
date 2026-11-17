"use client";

import { useEffect, useState } from "react";
import { useWakeArmed, useWakeDebug, wantsVoiceDebug } from "@/lib/wake-word";

// The founder's diagnostic for talking to Michael on a real phone: open any screen with ?debug=voice
// and a small pill sits at the top ("Armed" while the wake word listens, "Voice" otherwise). Tap it
// to see what the recogniser last heard, its sessions and restarts, and the last steps of a hold
// (how long the microphone took to open, what was recorded, what the API heard, the answer).
// Hidden unless asked for, in every build; ?debug=off hides it again.

const KEY = "michael.debug.voice";

function useVoiceDebug(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let remembered = false;
    try {
      remembered = sessionStorage.getItem(KEY) === "1";
    } catch {
      // Private mode: only while ?debug=voice is in the address.
    }
    const next = wantsVoiceDebug(window.location.search, remembered);
    try {
      if (next) sessionStorage.setItem(KEY, "1");
      else sessionStorage.removeItem(KEY);
    } catch {
      // As above.
    }
    setOn(next);
  }, []);
  return on;
}

function ago(at: number, now: number): string {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

export function WakeDebugPill() {
  const on = useVoiceDebug();
  const armed = useWakeArmed();
  const d = useWakeDebug();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  if (!on) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--m-safe-top)+8px)] z-40 flex flex-col items-center px-4 lg:pl-[calc(16rem+16px)]">
      <button
        type="button"
        data-testid="wake-debug"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="press pointer-events-auto flex h-7 items-center rounded-full bg-[#000] px-3 text-caption font-semibold text-[#fff] tnum"
      >
        {armed ? `Armed ${d.sessions}` : "Voice"}
      </button>
      {open ? (
        <dl
          data-testid="wake-debug-card"
          className="m-float m-solid m-pop-in pointer-events-auto mt-2 grid w-full max-w-[360px] grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-card px-4 py-3 text-footnote [--m-origin:50%_0]"
        >
          <dt className="text-label-2">Last heard</dt>
          <dd className="min-w-0 break-words text-label">
            {d.heard ? `"${d.heard}" ${ago(d.heardAt, now)}` : "Nothing yet"}
          </dd>
          <dt className="text-label-2">Sessions</dt>
          <dd className="text-label tnum">{d.sessions}</dd>
          <dt className="text-label-2">Last end</dt>
          <dd className="text-label">{d.lastEnd || "None yet"}</dd>
          <dt className="text-label-2">Restart gap</dt>
          <dd className="text-label tnum">{d.gapMs === null ? "None yet" : `${d.gapMs} ms`}</dd>
          <dt className="col-span-2 mt-1 text-label-2">Last steps</dt>
          <dd data-testid="voice-steps" className="col-span-2 min-w-0 break-words text-label tnum">
            {d.steps.length ? (
              <ol>
                {d.steps.map((step, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a log; steps can repeat word for word.
                  <li key={i}>{step}</li>
                ))}
              </ol>
            ) : (
              "Hold Mi to talk, then look here."
            )}
          </dd>
        </dl>
      ) : null}
    </div>
  );
}
