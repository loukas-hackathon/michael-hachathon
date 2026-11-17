"use client";

import type { Recommendation } from "@michael/shared";
import Link from "next/link";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { ActionChips } from "@/app/chat/action-chips";
import {
  chatLineCount,
  currentLines,
  currentSteps,
  currentThread,
  useChatSession,
} from "@/app/chat/chat-session";
import { currentStep } from "@/components/chat/steps";
import { haptic } from "@/components/haptics";
import { useOffTheRecord } from "@/lib/off-the-record";
import { onWake, setWakeHeard, takeWake, useWakeHeard, useWakeSetting } from "@/lib/wake-word";
import {
  conversationPhase,
  endConversation,
  MISSED_COPY,
  type Phase,
  startConversation,
  TYPE_COPY,
  tapConversation,
  useConversation,
} from "./conversation";
import { playEarcon, primeEarcons } from "./earcons";
import { holdElevenlabs } from "./hold-to-talk";
import { LivingVoice, type VoiceMood } from "./living-voice";
import { UNSUPPORTED_COPY } from "./speech";
import { WakeDebugPill } from "./wake-debug";

// "Yo Michael": where Michael answers when woken by his name. A small black capsule at the top of
// the screen, the island, with his living voice inside and one word for the state; under it, when
// there is something to read, the answer card (the floating material). The screen underneath stays
// usable. On the wake, in the same frame: one haptic tick, the wake earcon, one pink bloom round
// the edge of the screen (720ms, once) and the island opening from its top edge. He listens,
// thinks and speaks from here; a tap does the one obvious thing; swipe up, Escape or a tap outside
// closes it. It closes on its own after a quiet wake (4s), after the follow up window (5s), and
// 6s after a line that something went wrong. Holding the Mi button opens it too (hold-to-talk.tsx):
// it listens while held, answers once let go, and keeps the answer on screen for 6s.

const STATUS: Record<Phase, string> = {
  off: "Tap to retry",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Tap to cut in",
  unavailable: "",
};

/** How long a line about a miss or a failure stays before the island closes. */
const HOLD_MS = 6000;
/** Thinking longer than this shows the step he is on; longer than SLOW_MS says he is still at it. */
const STEP_MS = 1000;
const SLOW_MS = 8000;
const EXIT_MS = 200;

type Stage = "closed" | "open" | "closing";

export function WakeIsland() {
  const talk = useConversation();
  const heard = useWakeHeard();
  const setting = useWakeSetting();
  const session = useChatSession();
  const [stage, setStage] = useState<Stage>("closed");
  // Each wake blooms once: the key restarts the one shot animation.
  const [bloom, setBloom] = useState(0);
  // Only this wake's lines count: the chat's line count when it woke.
  const [from, setFrom] = useState(0);
  // A line kept on screen after the conversation ended (a miss, a failure), and its timer.
  const [hold, setHold] = useState<string | null>(null);
  const [wait, setWait] = useState<0 | 1 | 2>(0);
  const root = useRef<HTMLDivElement>(null);
  const elevenlabs = useRef(false);
  const ran = useRef(false);
  const asked = useRef(false);
  const turns = useRef(0);
  turns.current = talk.turns;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const swipe = useRef<{ y: number; done: boolean } | null>(null);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  const clearLater = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };

  // Whether his own voice (ElevenLabs) is available, asked once while the wake word is on.
  useEffect(() => {
    if (setting.mode === "off") return;
    primeEarcons();
    fetch("/chat/voice")
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { elevenlabs?: boolean } | null) => {
        elevenlabs.current = v?.elevenlabs === true;
      })
      .catch(() => {});
  }, [setting.mode]);

  const begin = (first: string | null, held = false) => {
    clearLater();
    setHold(null);
    setFrom(chatLineCount());
    ran.current = false;
    asked.current = !!first;
    startConversation({
      elevenlabs: elevenlabs.current || holdElevenlabs(),
      wake: true,
      ...(held ? { hold: true } : {}),
      ...(first ? { first } : {}),
    });
  };

  const close = () => {
    clearLater();
    // Closed by hand while he was still at it: the end earcon if he listened to a request.
    if (ran.current && (asked.current || turns.current > 0)) playEarcon("end");
    ran.current = false;
    if (conversationPhase() !== "off") endConversation();
    setStage((s) => (s === "closed" ? s : "closing"));
    later(() => {
      setStage("closed");
      setHold(null);
    }, EXIT_MS);
  };

  // The wake: haptic, earcon, bloom and the island in the same frame, listening already running.
  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribed once; begin reads refs.
  useEffect(() => {
    const woken = () => {
      const w = takeWake();
      if (!w) return;
      setWakeHeard(false);
      haptic();
      playEarcon("wake");
      setBloom((b) => b + 1);
      setStage("open");
      begin(w.first, w.hold === true);
    };
    woken();
    return onWake(woken);
  }, []);

  // The conversation ended: the end earcon if he listened to a request, then close, or hold the
  // line that says what went wrong for a few seconds first.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the phase only.
  useEffect(() => {
    if (stage !== "open") return;
    const running = talk.phase !== "off" && talk.phase !== "unavailable";
    if (running) {
      ran.current = true;
      return;
    }
    if (talk.phase === "unavailable") {
      setHold(UNSUPPORTED_COPY);
      later(close, HOLD_MS);
      return;
    }
    if (!ran.current) return;
    ran.current = false;
    if (asked.current || talk.turns > 0) playEarcon("end");
    if (talk.note) {
      setHold(talk.note);
      later(close, HOLD_MS);
    } else if (talk.hold && talk.turns > 0) {
      // Held: one answer, kept on screen to read; the next hold asks again.
      later(close, HOLD_MS);
    } else close();
  }, [talk.phase, stage]);

  // A request was heard (for the end earcon).
  useEffect(() => {
    if (talk.heard.trim()) asked.current = true;
  }, [talk.heard]);

  // Thinking: the step after a second, "Still reading your day." after eight.
  useEffect(() => {
    setWait(0);
    if (talk.phase !== "thinking") return;
    const a = setTimeout(() => setWait(1), STEP_MS);
    const b = setTimeout(() => setWait(2), SLOW_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [talk.phase]);

  // Off the record, or the app hidden: he stops listening at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close is stable in effect.
  useEffect(() => {
    if (stage !== "open") return;

    const onHide = () => {
      if (document.visibilityState === "hidden") close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // A tap outside the island and its card closes it; the tap still reaches what it was on.
    // A press on the Mi button is the next hold, not a tap outside: the island stays for it.
    const onDown = (e: globalThis.PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-hold-talk]")) return;
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) close();
    };
    document.addEventListener("visibilitychange", onHide);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, { capture: true });
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, { capture: true });
    };
  }, [stage]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: on unmount only; clearLater reads a ref.
  useEffect(() => () => clearLater(), []);

  const dim = stage === "closed" && heard;
  if (stage === "closed" && !heard) {
    return (
      <>
        <Bloom n={bloom} />
        <WakeDebugPill />
      </>
    );
  }

  const phase = talk.phase;
  const ended = phase === "off" || phase === "unavailable";
  const thread = currentThread(session);
  const lines = stage === "open" || stage === "closing" ? currentLines(session).slice(from) : [];
  const reply = lines.findLast((l) => l.role === "assistant")?.content ?? "";
  const replyDone =
    lines.findLast((l) => l.role === "assistant" && l.id !== thread.streamingId)?.content ?? "";
  const actions: Recommendation[] = lines.flatMap((l) =>
    l.role === "assistant" ? (thread.acted[l.id] ?? []) : [],
  );
  const followUp = phase === "listening" && talk.turns > 0 && !talk.heard.trim();
  const missed = talk.note === MISSED_COPY && !talk.heard.trim() && phase !== "thinking";
  const step =
    phase === "thinking" && !reply && wait > 0
      ? wait === 2
        ? "Still reading your day."
        : (currentStep(currentSteps(session))?.label ?? "Reading your day")
      : null;
  const note = hold ?? (missed ? MISSED_COPY : null);
  const mood: VoiceMood = dim
    ? "listening"
    : ended
      ? hold && hold !== TYPE_COPY
        ? "muted"
        : "idle"
      : missed
        ? "idle"
        : followUp
          ? "follow"
          : phase === "listening" || phase === "thinking" || phase === "speaking"
            ? phase
            : "idle";
  const word = dim ? "Listening" : ended ? (hold ? STATUS.off : "") : STATUS[phase];
  const you = phase === "listening" || phase === "thinking" ? talk.heard.trim() : "";
  const card = !dim && (you || reply || step || note || actions.length > 0);

  function tap() {
    if (stage !== "open") return;
    if (phase === "speaking") {
      // Cut in: his voice ramps down in 120ms and he listens. One tick, no earcon, no apology.
      haptic();
      tapConversation();
    } else if (phase === "listening") {
      if (talk.heard.trim()) tapConversation();
      else close();
    } else if (ended) {
      begin(null);
    }
  }

  const onPointerDown = (e: PointerEvent) => {
    swipe.current = { y: e.clientY, done: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const s = swipe.current;
    if (s && !s.done && s.y - e.clientY > 24) {
      s.done = true;
      close();
    }
  };

  return (
    <>
      <Bloom n={bloom} />
      {stage === "open" ? <OffTheRecordStops onStop={close} /> : null}
      <div
        ref={root}
        className="pointer-events-none fixed inset-x-0 top-[calc(var(--m-safe-top)+8px)] z-40 flex flex-col items-center px-4 lg:pl-[calc(16rem+16px)]"
      >
        <button
          type="button"
          onClick={() => {
            if (swipe.current?.done) return;
            tap();
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          aria-label={word || "Michael"}
          data-testid="wake-island"
          data-phase={dim ? "heard" : ended ? "ended" : phase}
          data-heard={dim || undefined}
          data-closing={stage === "closing" || undefined}
          className="m-island press pointer-events-auto flex h-11 w-[168px] touch-none items-center gap-2.5 overflow-hidden rounded-full bg-[#000] pr-4 pl-1.5 text-left"
        >
          <span className="relative size-8 shrink-0">
            <LivingVoice mood={mood} level={talk.level} words={you ? you.split(/\s+/).length : 0} />
          </span>
          <span
            key={word}
            className={`m-swap min-w-0 truncate text-subhead font-semibold text-[#fff] ${phase === "speaking" && !ended ? "opacity-60" : ""}`}
          >
            {word}
          </span>
        </button>

        {card ? (
          <div
            data-testid="wake-card"
            data-closing={stage === "closing" || undefined}
            className="m-float m-solid m-island-card m-pop-in pointer-events-auto mt-2 w-full max-w-[360px] rounded-card px-4 py-3.5"
          >
            {you ? (
              <p
                className="truncate text-subhead text-label-2 [direction:rtl] text-left"
                data-testid="wake-heard"
              >
                <bdi>{you}</bdi>
              </p>
            ) : null}
            {reply ? (
              <p className="line-clamp-4 text-body text-label" data-testid="wake-reply">
                {reply}
              </p>
            ) : null}
            {step ? (
              <p key={step} className="m-swap text-subhead text-label-2">
                {step}
              </p>
            ) : null}
            {note ? (
              <p
                key={note}
                className={`m-swap text-body text-label ${reply ? "mt-2" : ""}`}
                data-testid="wake-note"
              >
                {note}
              </p>
            ) : null}
            {hold === TYPE_COPY ? (
              <Link
                href="/chat"
                onClick={() => close()}
                className="press mt-2 inline-flex h-9 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text"
              >
                Open the keyboard
              </Link>
            ) : null}
            {actions.length ? (
              <div className="mt-2">
                <ActionChips actions={actions} quiet />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Screen readers: the state as it changes, then his reply once it is complete. */}
        <p className="sr-only" aria-live="polite">
          {dim ? "" : word}
        </p>
        <p className="sr-only" aria-live="polite">
          {replyDone}
        </p>
      </div>
    </>
  );
}

/** The one pink edge bloom, once per wake (globals.css .m-wake-bloom); nothing between wakes. */
function Bloom({ n }: { n: number }) {
  if (n === 0) return null;
  return <div key={n} aria-hidden="true" className="m-wake-bloom" data-on="" />;
}

/** Off the record stops all collection: he stops listening at once (mounted only while open). */
function OffTheRecordStops({ onStop }: { onStop: () => void }) {
  const { on } = useOffTheRecord();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the switch only.
  useEffect(() => {
    if (on) onStop();
  }, [on]);
  return null;
}
