"use client";

import { useEffect, useRef } from "react";
import { Michael, type MichaelState } from "@/components/michael";
import { onSpeechBeat } from "@/components/voice/speech";

// Michael in the onboarding talk: the living Mi mark in its dark circle, the same as the chat's
// conversation sheet, at a size that leaves room for his line and the user's words. Listening shows
// the voice: a ring that follows the microphone level where it can be read (a recording), or the
// listening ring plus a small swell with each word heard (the browser's recogniser). The mark
// breathes while he speaks, swelling with each word his browser voice says, and drifts while he
// thinks. A tap does the one obvious thing for the moment (cut in, done, listen again).

export type TalkState = "thinking" | "speaking" | "listening" | "transcribing" | "waiting";

const still = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One short swell of an element (a word said, a word heard). Nothing under reduced motion. */
function pulse(el: HTMLElement | null, scale: number) {
  if (!el || still() || typeof el.animate !== "function") return;
  const css = getComputedStyle(el);
  const dur = Number.parseFloat(css.getPropertyValue("--m-dur-ui")) || 200;
  el.animate([{ transform: "scale(1)" }, { transform: `scale(${scale})` }, { transform: "scale(1)" }], {
    duration: dur * 1.4,
    easing: css.getPropertyValue("--m-ease-out").trim() || "ease-out",
  });
}

export function VoiceOrb({
  state,
  muted,
  recorded,
  level,
  words,
  label,
  onTap,
  disabled,
}: {
  state: TalkState;
  muted: boolean;
  /** The turn is recorded: the ring follows the level. */
  recorded: boolean;
  level: number;
  /** How many words heard so far: each new one swells the mark a little. */
  words: number;
  label: string;
  onTap: () => void;
  disabled?: boolean;
}) {
  const beat = useRef<HTMLSpanElement>(null);
  const heard = useRef<HTMLSpanElement>(null);
  useEffect(() => onSpeechBeat(() => pulse(beat.current, 1.05)), []);
  useEffect(() => {
    if (words) pulse(heard.current, 1.07);
  }, [words]);

  const listening = state === "listening" && !muted;
  const mi: MichaelState = muted
    ? "asleep"
    : state === "listening"
      ? "listening"
      : state === "speaking"
        ? "speaking"
        : state === "thinking" || state === "transcribing"
          ? "thinking"
          : "idle";

  return (
    <button
      type="button"
      onClick={onTap}
      disabled={disabled}
      aria-label={label}
      data-testid="talk-orb"
      data-state={state}
      className="press relative grid size-40 place-items-center rounded-full lg:size-48"
    >
      {listening && !recorded ? (
        <span
          aria-hidden="true"
          className="m-listen-ring pointer-events-none absolute inset-5 rounded-full bg-tint"
        />
      ) : null}
      {listening && recorded ? (
        <span
          aria-hidden="true"
          data-testid="voice-level"
          className="pointer-events-none absolute inset-5 rounded-full bg-tint opacity-25 transition-transform duration-75 motion-reduce:transition-none"
          style={{ transform: `scale(${1 + Math.min(level * 3, 0.35)})` }}
        />
      ) : null}
      <span ref={heard} className="relative grid place-items-center rounded-full">
        <span ref={beat} className="grid place-items-center rounded-full">
          <span
            className={`grid size-28 place-items-center rounded-full bg-label lg:size-32 text-bg transition-opacity duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] ${
              state === "speaking" ? "m-speak-breath" : ""
            } ${state === "thinking" || state === "transcribing" ? "m-think-soft" : ""} ${
              muted || state === "waiting" ? "opacity-60" : ""
            }`}
          >
            <Michael state={mi} className="block h-auto w-14 lg:w-16" />
          </span>
        </span>
      </span>
    </button>
  );
}

export function MicIcon({ off, className }: { off: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        {off ? <path d="M4 4l16 16" /> : null}
      </g>
    </svg>
  );
}
