"use client";

import { LivingVoice, type VoiceMood } from "@/components/voice/living-voice";

// Michael in the onboarding talk: his living voice (components/voice/living-voice.tsx), the Mi
// mark in its dark core wrapped in soft pink light that moves with the real sound. It follows the
// loudness of his voice while he speaks, leans in and follows the microphone while he listens (or
// swells with each word the browser's recogniser hears), swirls while he thinks, and breathes
// while he waits. Muted, it dims and holds still. A tap does the one obvious thing for the moment
// (cut in, done, listen again).

export type TalkState = "thinking" | "speaking" | "listening" | "transcribing" | "waiting";

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
  /** The turn is recorded: the light follows the microphone level. */
  recorded: boolean;
  level: number;
  /** How many words heard so far: each new one swells the light a little. */
  words: number;
  label: string;
  onTap: () => void;
  disabled?: boolean;
}) {
  const mood: VoiceMood = muted
    ? "muted"
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
      <LivingVoice
        mood={mood}
        level={level}
        words={words}
        levelTestId={mood === "listening" && recorded ? "voice-level" : undefined}
      />
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
