"use client";

import { useEffect, useState } from "react";
import { hasOnDeviceApi } from "@/components/voice/on-device";
import {
  CLOUD_LINE,
  LOCAL_LINE,
  MAYBE_LOCAL_LINE,
  NO_LOCAL,
  turnOnWake,
  useWakeSupport,
} from "@/components/voice/wake-enable";
import {
  micBlockedLine,
  setOfferChoice,
  setWakeSetting,
  supportLine,
  useWakeNote,
  useWakeSetting,
} from "@/lib/wake-word";

const separator = "absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator";

/**
 * "Yo Michael": the wake word (lib/wake-word.ts), off by default, per device. The line under it
 * says where the audio goes before and after it is on, so the user decides with the facts. Where it
 * cannot run (the iPhone Home Screen app, a browser with no recogniser, a blocked microphone) the
 * switch is off and greyed, and the line says exactly why and what to do: never a switch that
 * does nothing.
 */
export function WakeWordSwitch() {
  const setting = useWakeSetting();
  const note = useWakeNote();
  // Unknown on the server: nothing renders until the browser has said what it offers.
  const support = useWakeSupport();
  const [local, setLocal] = useState<boolean | null>(null);
  const [native, setNative] = useState(true);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    setNative("switch" in HTMLInputElement.prototype);
    setLocal(note !== NO_LOCAL && hasOnDeviceApi());
  }, [note]);
  // The permission changed in the browser's settings: say what is true now.
  // biome-ignore lint/correctness/useExhaustiveDependencies: support is the trigger.
  useEffect(() => setBlocked(null), [support]);

  if (support === null || local === null) return null;
  const on = setting.mode !== "off";
  const why = supportLine(support, navigator.userAgent);
  const usable = support === "ok" && !blocked;

  async function toggle(next: boolean) {
    if (!next) return setWakeSetting({ mode: "off" });
    setPending(true);
    try {
      const res = await turnOnWake({ cloud: !local });
      // A choice made here counts: Michael never offers it again.
      setOfferChoice("on");
      if (!res.ok && res.reason === "mic") setBlocked(micBlockedLine(navigator.userAgent));
      if (!res.ok && res.reason === "no-local") setLocal(false);
    } finally {
      setPending(false);
    }
  }

  const line = pending
    ? local
      ? "Getting on device listening ready"
      : "Asking for the microphone"
    : (blocked ??
      why ??
      (setting.mode === "local"
        ? LOCAL_LINE
        : setting.mode === "cloud"
          ? CLOUD_LINE
          : (note ?? (local ? MAYBE_LOCAL_LINE : CLOUD_LINE))));

  return (
    <label
      htmlFor="wake-word"
      className="relative flex min-h-14 items-center justify-between gap-4 px-4 py-2"
      data-testid="wake-word-row"
      data-support={blocked ? "mic-blocked" : support}
    >
      <span className={separator} />
      <span className="flex flex-col">
        <span className={`text-body ${usable ? "" : "text-label-2"}`}>Yo Michael</span>
        {usable ? (
          <span className="text-subhead text-label-2">Listen for my name while the app is open.</span>
        ) : null}
        <span
          key={line}
          className={`m-swap text-footnote ${usable ? "text-label-2" : "text-label"}`}
          aria-live="polite"
          data-testid="wake-word-line"
        >
          {line}
        </span>
      </span>
      <input
        id="wake-word"
        type="checkbox"
        // @ts-expect-error: `switch` is a valid boolean attribute in Safari, not yet in React's types
        switch=""
        checked={on && usable}
        aria-busy={pending || undefined}
        disabled={pending || !usable}
        onChange={(e) => {
          if (!pending) void toggle(e.target.checked);
        }}
        className={`${native ? "h-[31px] w-[51px] shrink-0 accent-[var(--m-tint)]" : "m-switch shrink-0"} disabled:opacity-40`}
      />
    </label>
  );
}
