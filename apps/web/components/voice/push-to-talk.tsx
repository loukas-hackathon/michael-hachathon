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
  primeSpeech,
  type Recognition,
  recognitionCtor,
  recognitionErrorCopy,
  transcriptOf,
  UNSUPPORTED_COPY,
} from "./speech";

const noop = () => () => {};

type Props = {
  disabled?: boolean;
  /** Words so far while the button is held, for the text box. */
  onInterim: (text: string) => void;
  /** Everything said, once the button is let go. Empty speech never arrives here. */
  onFinal: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  /** Michael's line when voice cannot work (unsupported browser, microphone refused). */
  onError: (message: string) => void;
};

/**
 * Hold to talk. Speech is turned into text by the browser (en-GB); nothing is recorded.
 * Pointer: press and hold, let go to send. Keyboard: hold Space or Enter.
 */
export function PushToTalk({ disabled, onInterim, onFinal, onListeningChange, onError }: Props) {
  // The server cannot know; assume yes so the button does not jump in after hydration.
  const supported = useSyncExternalStore(
    noop,
    () => recognitionCtor() !== null,
    () => true,
  );
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");
  const held = useRef(false);

  useEffect(() => () => rec.current?.abort(), []);

  function setOn(on: boolean) {
    setListening(on);
    onListeningChange?.(on);
  }

  function start() {
    if (disabled || held.current) return;
    const Ctor = recognitionCtor();
    if (!Ctor) {
      onError(UNSUPPORTED_COPY);
      return;
    }
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
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    start();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (!e.repeat) start();
  }

  function onKeyUp(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    stop();
  }

  const label = !supported
    ? "Voice is not available in this browser"
    : listening
      ? "Listening. Let go to send"
      : "Hold to talk to Michael";

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={listening}
      title={label}
      data-testid="push-to-talk"
      data-supported={supported}
      disabled={disabled && !listening}
      onPointerDown={onPointerDown}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onContextMenu={(e) => e.preventDefault()}
      className={`press relative grid h-9 w-9 shrink-0 touch-none select-none place-items-center rounded-full [-webkit-touch-callout:none] disabled:opacity-40 ${
        listening ? "bg-tint text-on-tint" : "bg-bg text-tint-text"
      } ${supported ? "" : "opacity-50"}`}
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
