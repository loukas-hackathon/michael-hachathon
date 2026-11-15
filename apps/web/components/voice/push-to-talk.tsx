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
  checkRecorderPath,
  currentInputMode,
  type InputMode,
  MicError,
  NOTHING_HEARD_COPY,
  primeRecorder,
  type Recording,
  releaseMic,
  startRecording,
  subscribeInputMode,
  TAP_MS,
  TAPPED_COPY,
  transcribeErrorCopy,
  transcribeRecording,
} from "./recorder";
import {
  DICTATE_COPY,
  hasTouchKeyboard,
  isIosHomeScreenApp,
  markRefused,
  meansNoVoiceHere,
  primeSpeech,
  type Recognition,
  recognitionCtor,
  recognitionErrorCopy,
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
  /** The recording is being turned into text (the recorder path only). */
  onTranscribingChange?: (transcribing: boolean) => void;
  /** Michael's line when voice cannot work (unsupported browser, microphone refused). */
  onError: (message: string) => void;
  /** Where the app cannot listen on a phone: open the keyboard so its own mic can dictate. */
  onDictate?: () => void;
};

/**
 * Hold to talk. Speech becomes text in the browser (en-GB), or, where the browser cannot (an
 * iPhone home screen app) or does it badly (iOS), the sentence is recorded and the API transcribes
 * it; the audio is dropped once it is text. Pointer: press and hold, let go to send. Keyboard:
 * hold Space or Enter. Where neither can run, a tap opens the keyboard and points to its mic.
 */
export function PushToTalk({
  disabled,
  onInterim,
  onFinal,
  onListeningChange,
  onTranscribingChange,
  onError,
  onDictate,
}: Props) {
  // The server cannot know; assume the recogniser so the button does not jump in after hydration.
  const mode = useSyncExternalStore<InputMode>(subscribeInputMode, currentInputMode, () => "recognition");
  const supported = mode !== "none";
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);
  const rec = useRef<Recognition | null>(null);
  const recording = useRef<Recording | null>(null);
  const heard = useRef("");
  const held = useRef(false);
  const alive = useRef(true);
  // When the press began, and whether it was a quick tap: a tap is someone looking for Talk.
  const pressedAt = useRef(0);
  const tapped = useRef(false);
  const erred = useRef(false);

  useEffect(() => {
    alive.current = true;
    checkRecorderPath();
    // Leaving the screen mid hold drops what was heard: nothing is sent from a screen that is gone.
    return () => {
      alive.current = false;
      const r = rec.current;
      if (r) {
        r.onresult = null;
        r.onerror = null;
        r.onend = null;
        r.abort();
        rec.current = null;
      }
      recording.current?.cancel();
      recording.current = null;
      held.current = false;
      releaseMic();
    };
  }, []);

  function setOn(on: boolean) {
    setListening(on);
    onListeningChange?.(on);
  }

  function setBusy(on: boolean) {
    setTranscribing(on);
    onTranscribingChange?.(on);
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
    if (disabled || held.current || transcribing) return;
    pressedAt.current = Date.now();
    tapped.current = false;
    erred.current = false;
    const now = currentInputMode();
    if (now === "recorder") return startRecorder();
    if (now !== "recognition") return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
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
        // The API may still listen for us: the next press records instead.
        checkRecorderPath();
        fallback();
        return;
      }
      const copy = recognitionErrorCopy(e.error);
      if (copy) {
        onError(copy);
        tapped.current = false;
        erred.current = true;
      }
      heard.current = e.error === "no-speech" ? "" : heard.current;
    };
    r.onend = () => {
      rec.current = null;
      held.current = false;
      setOn(false);
      const text = heard.current.trim();
      heard.current = "";
      if (text) onFinal(text);
      else if (tapped.current && !erred.current) onError(TAPPED_COPY);
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

  // ---------- the recorder path ----------

  function startRecorder() {
    held.current = true;
    primeSpeech();
    primeRecorder();
    onInterim("");
    setOn(true);
    startRecording({ onLevel: setLevel, onLimit: () => stop() })
      .then((r) => {
        if (!alive.current) return r.cancel();
        recording.current = r;
        // Let go while the microphone was still starting: too short, said so by finishRecorder.
        if (!held.current) void finishRecorder();
      })
      .catch((err: unknown) => {
        held.current = false;
        setOn(false);
        if (!alive.current) return;
        onError(recognitionErrorCopy(err instanceof MicError ? err.code : "unknown") as string);
      });
  }

  async function finishRecorder() {
    const r = recording.current;
    recording.current = null;
    if (!r) return;
    setOn(false);
    setLevel(0);
    const blob = await r.stop();
    releaseMic();
    if (!alive.current) return;
    if (!blob) return onError(tapped.current ? TAPPED_COPY : NOTHING_HEARD_COPY);
    setBusy(true);
    const res = await transcribeRecording(blob);
    if (!alive.current) return;
    setBusy(false);
    if (!res.ok) return onError(transcribeErrorCopy(res.code));
    if (!res.text) return onError(NOTHING_HEARD_COPY);
    // "Got it": the words land in the box, then go.
    onInterim(res.text);
    onFinal(res.text);
  }

  function stop() {
    if (!held.current) return;
    held.current = false;
    tapped.current = Date.now() - pressedAt.current < TAP_MS;
    if (rec.current) {
      // onend fires after the last words are in, and sends them.
      rec.current.stop();
      held.current = true;
    } else {
      void finishRecorder();
    }
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
    : transcribing
      ? "Got it. Writing it down"
      : listening
        ? "Listening. Let go to send"
        : "Hold to dictate";

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={supported ? listening : undefined}
      aria-busy={transcribing || undefined}
      title={label}
      data-testid="push-to-talk"
      data-supported={supported}
      data-mode={mode}
      disabled={(disabled || transcribing) && !listening}
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
      {listening && mode === "recorder" ? (
        // The live level while recording: grows with the voice, so the user sees it is heard.
        <span
          aria-hidden="true"
          data-testid="voice-level"
          className="pointer-events-none absolute inset-0 rounded-full bg-tint opacity-30 transition-transform duration-75"
          style={{ transform: `scale(${1 + Math.min(level * 6, 0.8)})` }}
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
