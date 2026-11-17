"use client";

import { type MouseEvent, type PointerEvent, useEffect, useRef } from "react";
import { haptic } from "@/components/haptics";
import { markHintSeen, useHint } from "@/components/hint";
import { useOffTheRecord } from "@/lib/off-the-record";
import { emitWake } from "@/lib/wake-word";
import { releaseHold } from "./conversation";
import { checkRecorderPath, primeRecorder } from "./recorder";
import { primeSpeech } from "./speech";

// Press and hold the Mi button to talk, like holding the side button for Siri. It works wherever
// the microphone does, the iPhone Home Screen app included: there the turn is recorded and the API
// transcribes it (recorder.ts), elsewhere the browser's recogniser hears it. Hold: the island opens
// listening (wake-island.tsx); let go: he answers there. A short tap keeps the button's own action.

/** Held this long, a press is a hold, not a tap (a tap on Mi still opens You). */
export const HOLD_PRESS_MS = 350;
/** The one time hint near Mi, after the first answer in Chat. */
export const HOLD_HINT = "hold-mi";
export const HOLD_HINT_LINE = "Hold me to talk.";

let elevenlabs = false;
let asked = false;

/** Whether his own voice (ElevenLabs) answers a hold, asked once per visit. */
export const holdElevenlabs = (): boolean => elevenlabs;

/**
 * Inside the press, before the hold is sure: what the turn will need is made ready, so it starts
 * with no wait. Whether the API can transcribe (iPhone), the level meter's audio, the voices.
 */
export function prepareHold(): void {
  checkRecorderPath();
  primeRecorder();
  primeSpeech();
  if (asked) return;
  asked = true;
  fetch("/chat/voice")
    .then((r) => (r.ok ? r.json() : null))
    .then((v: { elevenlabs?: boolean } | null) => {
      elevenlabs = v?.elevenlabs === true;
    })
    .catch(() => {});
}

/**
 * The handlers that make an element (the Mi button) hold to talk. Spread them on the element; a
 * short tap still does its own thing, a hold never does. Nothing happens off the record.
 */
export function useHoldToTalk() {
  const { on: offTheRecord } = useOffTheRecord();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holding = useRef(false);
  // A hold just ended: the click that follows the release must not open the link.
  const swallow = useRef(false);

  useEffect(() => {
    // Where the turn will be recorded (iPhone, no recogniser), learn early whether the API can
    // transcribe, so the first hold already takes the path that works. A no-op elsewhere.
    checkRecorderPath();
    return () => {
      clearTimeout(timer.current);
      if (holding.current) releaseHold();
    };
  }, []);

  const end = () => {
    clearTimeout(timer.current);
    if (!holding.current) return;
    holding.current = false;
    swallow.current = true;
    setTimeout(() => {
      swallow.current = false;
    }, 600);
    haptic();
    releaseHold();
  };

  return {
    "data-hold-talk": "",
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (offTheRecord || (e.pointerType === "mouse" && e.button !== 0)) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Not every pointer can be captured; the release still arrives on the button.
      }
      prepareHold();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        holding.current = true;
        haptic();
        markHintSeen(HOLD_HINT);
        emitWake({ first: null, hold: true });
      }, HOLD_PRESS_MS);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClick(e: MouseEvent<HTMLElement>) {
      if (holding.current || swallow.current) {
        e.preventDefault();
        swallow.current = false;
      }
    },
    // A long press is ours: no link preview, callout or text selection.
    onContextMenu(e: MouseEvent<HTMLElement>) {
      e.preventDefault();
    },
    style: {
      WebkitTouchCallout: "none",
      WebkitUserSelect: "none",
      userSelect: "none",
      touchAction: "none",
    } as const,
  };
}

/**
 * "Hold me to talk.": one small callout under the Mi button, once, after his first answer in Chat.
 * It goes for good after a hold or a tap on it.
 */
export function HoldHint() {
  const show = useHint(HOLD_HINT);
  if (!show) return null;
  return (
    <button
      type="button"
      data-testid="hold-hint"
      onClick={() => markHintSeen(HOLD_HINT)}
      className="m-float m-solid m-pop-in press absolute top-full right-0 z-30 mt-1.5 flex min-h-9 items-center gap-2 whitespace-nowrap rounded-control px-3 text-footnote font-semibold text-label [--m-origin:100%_0]"
    >
      {HOLD_HINT_LINE}
      <span className="font-normal text-label-2">Got it</span>
    </button>
  );
}
