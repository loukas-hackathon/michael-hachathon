"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  DICTATE_COPY,
  hasTouchKeyboard,
  isIosHomeScreenApp,
  markRefused,
  meansNoVoiceHere,
  primeSpeech,
  type Recognition,
  readRefused,
  recognitionCtor,
  recognitionErrorCopy,
  subscribeRefused,
  transcriptOf,
  UNSUPPORTED_COPY,
  unlockAudio,
} from "./speech";

type Props = {
  disabled?: boolean;
  /** Words so far while the button is held, for the text box. */
  onInterim: (text: string) => void;
  /** Everything said, once the button is let go. Empty speech never arrives here. */
  onFinal: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  /** Michael's line when voice cannot work (unsupported browser, microphone refused). */
  onError: (message: string) => void;
  /** Where the app cannot listen on a phone: open the keyboard so its own mic can dictate. */
  onDictate?: () => void;
};

/**
 * Hold to talk. Speech is turned into text by the browser (en-GB); nothing is recorded.
 * Pointer: press and hold, let go to send. Keyboard: hold Space or Enter.
 * Where recognition cannot run, a tap opens the keyboard and points to its dictation mic.
 */
export function PushToTalk({ disabled, onInterim, onFinal, onListeningChange, onError, onDictate }: Props) {
  // The server cannot know; assume yes so the button does not jump in after hydration.
  const supported = useSyncExternalStore(
    subscribeRefused,
    () => recognitionCtor() !== null && !readRefused(),
    () => true,
  );
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");
  const held = useRef(false);

  // Leaving the screen mid hold drops what was heard: nothing is sent from a screen that is gone.
  useEffect(
    () => () => {
      const r = rec.current;
      if (!r) return;
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      r.abort();
      rec.current = null;
    },
    [],
  );

  function setOn(on: boolean) {
    setListening(on);
    onListeningChange?.(on);
  }

  /** No voice in this browser: on a phone, hand over to the keyboard's dictation. */
  function fallback() {
    if (hasTouchKeyboard() || isIosHomeScreenApp()) {
      onDictate?.();
      onError(DICTATE_COPY);
    } else {
      onError(UNSUPPORTED_COPY);
    }
  }

  function start() {
    if (disabled || held.current) return;
    const Ctor = recognitionCtor();
    if (!Ctor || readRefused()) return;
    held.current = true;
    heard.current = "";
    primeSpeech();
    const r = new Ctor();
    r.lang = "en-GB";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      heard.current = transcriptOf(e);
      onInterim(heard.current);
    };
    r.onerror = (e) => {
      if (meansNoVoiceHere(e.error, isIosHomeScreenApp())) {
        heard.current = "";
        onInterim("");
        markRefused();
        fallback();
        return;
      }
      const copy = recognitionErrorCopy(e.error);
      if (copy) onError(copy);
      heard.current = e.error === "no-speech" ? "" : heard.current;
    };
    r.onend = () => {
      rec.current = null;
      held.current = false;
      setOn(false);
      const text = heard.current.trim();
      heard.current = "";
      if (text) onFinal(text);
    };
    rec.current = r;
    try {
      r.start();
      setOn(true);
    } catch {
      held.current = false;
      rec.current = null;
      onError(recognitionErrorCopy("unknown") as string);
    }
  }

  function stop() {
    if (!held.current) return;
    // onend fires after the last words are in, and sends them.
    rec.current?.stop();
    // The release is a tap: the one moment iOS lets the reply's voice be unlocked.
    unlockAudio();
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (!supported || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    start();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!supported || (e.key !== " " && e.key !== "Enter")) return;
    e.preventDefault();
    if (!e.repeat) start();
  }

  function onKeyUp(e: KeyboardEvent<HTMLButtonElement>) {
    if (!supported || (e.key !== " " && e.key !== "Enter")) return;
    e.preventDefault();
    stop();
  }

  const dictate = !supported && (hasTouchKeyboard() || isIosHomeScreenApp());
  const label = !supported
    ? dictate
      ? "Dictate with your keyboard's mic"
      : "Voice is not available in this browser"
    : listening
      ? "Listening. Let go to send"
      : "Hold to talk to Michael";

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={supported ? listening : undefined}
      title={label}
      data-testid="push-to-talk"
      data-supported={supported}
      disabled={disabled && !listening}
      onPointerDown={onPointerDown}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      // Without voice a tap (a click, so iOS lets the keyboard open) explains what to do instead.
      onClick={supported ? undefined : fallback}
      onContextMenu={(e) => e.preventDefault()}
      className={`hit press relative grid h-9 w-9 shrink-0 touch-none select-none place-items-center rounded-full [-webkit-touch-callout:none] disabled:opacity-40 ${
        listening ? "bg-tint text-on-tint" : "bg-bg text-tint-text"
      } ${supported || dictate ? "" : "opacity-50"}`}
    >
      {listening ? (
        <span
          aria-hidden="true"
          className="m-listen-ring pointer-events-none absolute inset-0 rounded-full bg-tint"
        />
      ) : null}
      <MicIcon className="relative h-5 w-5" />
    </button>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11.5" rx="3" fill="currentColor" />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
