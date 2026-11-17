"use client";

import { useEffect, useState } from "react";
import { primeEarcons } from "@/components/voice/earcons";
import { hasOnDeviceApi, prepareOnDevice } from "@/components/voice/on-device";
import { readRefused, recognitionCtor, unlockAudio } from "@/components/voice/speech";
import { setWakeSetting, useWakeNote, useWakeSetting } from "@/lib/wake-word";

const separator = "absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator";

const LOCAL_LINE = "Heard on this device, only while the app is open.";
const MAYBE_LOCAL_LINE = "On this device where Chrome can, else its speech service hears it.";
const CLOUD_LINE = "Your browser's speech service hears what is said while I listen.";
const NO_LOCAL = "I couldn't get on device listening. Switch on again to use the browser's speech service.";

/** What this browser offers, known in the browser only. */
type Support = "unsupported" | "maybe-local" | "cloud";

/**
 * "Yo Michael": the wake word (lib/wake-word.ts), off by default, per device. The line
 * under it says where the audio goes before and after it is on, so the user decides with the facts.
 * Hidden where the browser has no speech recognition.
 */
export function WakeWordSwitch() {
  const setting = useWakeSetting();
  const note = useWakeNote();
  // Unknown on the server: nothing renders until the browser has said what it offers.
  const [support, setSupport] = useState<Support | null>(null);
  const [native, setNative] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setNative("switch" in HTMLInputElement.prototype);
    if (!recognitionCtor() || (readRefused() && !note)) setSupport("unsupported");
    else if (note === NO_LOCAL || !hasOnDeviceApi()) setSupport("cloud");
    else setSupport("maybe-local");
  }, [note]);

  if (support === null || support === "unsupported") return null;
  const on = setting.mode !== "off";

  async function toggle(next: boolean) {
    if (!next) return setWakeSetting({ mode: "off" });
    // The tap: iOS lets his voice play later only after sound inside one.
    unlockAudio();
    primeEarcons();
    if (support !== "maybe-local") return setWakeSetting({ mode: "cloud", lang: "en-GB" });
    setPending(true);
    try {
      const lang = await prepareOnDevice();
      if (lang) {
        setWakeSetting({ mode: "local", lang });
      } else {
        // Never the cloud without saying so first: off, with the reason, and the next tap knows.
        setSupport("cloud");
        setWakeSetting({ mode: "off" }, NO_LOCAL);
      }
    } finally {
      setPending(false);
    }
  }

  const line = pending
    ? "Getting on device listening ready"
    : setting.mode === "local"
      ? LOCAL_LINE
      : setting.mode === "cloud"
        ? CLOUD_LINE
        : (note ?? (support === "maybe-local" ? MAYBE_LOCAL_LINE : CLOUD_LINE));

  return (
    <label
      htmlFor="wake-word"
      className="relative flex min-h-14 items-center justify-between gap-4 px-4 py-2"
      data-testid="wake-word-row"
    >
      <span className={separator} />
      <span className="flex flex-col">
        <span className="text-body">Yo Michael</span>
        <span className="text-subhead text-label-2">Listen for my name while the app is open.</span>
        <span key={line} className="m-swap text-footnote text-label-2" aria-live="polite">
          {line}
        </span>
      </span>
      <input
        id="wake-word"
        type="checkbox"
        // @ts-expect-error: `switch` is a valid boolean attribute in Safari, not yet in React's types
        switch=""
        checked={on}
        aria-busy={pending || undefined}
        disabled={pending}
        onChange={(e) => {
          if (!pending) void toggle(e.target.checked);
        }}
        className={native ? "h-[31px] w-[51px] shrink-0 accent-[var(--m-tint)]" : "m-switch shrink-0"}
      />
    </label>
  );
}
