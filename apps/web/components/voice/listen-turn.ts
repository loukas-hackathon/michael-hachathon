"use client";

import {
  type InputMode,
  MicError,
  type Recording,
  releaseMic,
  startRecording,
  startSideMeter,
  transcribeRecording,
} from "./recorder";
import {
  isIosHomeScreenApp,
  markRefused,
  meansNoVoiceHere,
  type Recognition,
  recognitionCtor,
  transcriptOf,
} from "./speech";

// One spoken turn, hands free: listen until the user has said something and paused, then hand back
// the words. The same machinery as the chat's conversation (conversation.ts), as a piece any screen
// can drive: the browser's recogniser where it works (live words as they speak, the pause after the
// last word ends the turn), or a recording where it does not (iPhone: the microphone level ends the
// turn after a pause, and the API turns the recording into text and drops the audio).

export type TurnError =
  /** The microphone is refused. */
  | "not-allowed"
  /** No microphone. */
  | "audio-capture"
  /** This browser cannot listen here at all (an iPhone home screen app). */
  | "no-voice"
  /** Recognition or transcription failed for a moment (network, the API). */
  | "failed";

export type TurnHandlers = {
  /** What the user is saying, live (the recogniser), or all of it once transcribed (recording). */
  onWords?: (text: string) => void;
  /** Microphone level 0..1 about twenty times a second while recording. */
  onLevel?: (level: number) => void;
  /** The user has started speaking. */
  onSpeech?: () => void;
  /** The recording is on its way to the API to become text. */
  onTranscribing?: () => void;
  /** The turn is over. Empty when nothing usable was heard. */
  onDone: (text: string) => void;
  /** Nothing said for `quietMs`. */
  onQuiet?: () => void;
  onError: (error: TurnError) => void;
};

export type TurnOptions = {
  mode: Exclude<InputMode, "none">;
  /** A pause this long after the last word ends the turn. */
  pauseMs?: number;
  /** Nothing said for this long ends the turn with onQuiet. */
  quietMs?: number;
};

export type Turn = {
  /** True when the level can be read (or the recogniser runs): the turn ends on its own on a pause. */
  readonly auto: boolean;
  /** The user says they are done: ends the turn now with what was heard. */
  finish(): void;
  /** Stops listening and throws the turn away. No handler runs after this. */
  cancel(): void;
};

/** Thinking time is allowed: people pause mid answer when asked about their week. */
export const ANSWER_PAUSE_MS = 1700;
export const ANSWER_QUIET_MS = 15000;

/** Starts listening for one turn. Call after a tap at least once per page, so iOS allows audio. */
export function listenTurn(h: TurnHandlers, opts: TurnOptions): Turn {
  return opts.mode === "recorder" ? recordedTurn(h, opts) : recognisedTurn(h, opts);
}

function recognisedTurn(h: TurnHandlers, opts: TurnOptions): Turn {
  const pauseMs = opts.pauseMs ?? ANSWER_PAUSE_MS;
  const quietMs = opts.quietMs ?? ANSWER_QUIET_MS;
  const Ctor = recognitionCtor();
  let over = false;
  let heard = "";
  let rec: Recognition | null = null;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  const quietTimer = setTimeout(() => {
    if (!heard.trim()) end(() => h.onQuiet?.());
  }, quietMs);
  // The living voice follows the microphone where a side meter can run (onMicLevel), not onLevel:
  // the recogniser ends the turn, so nothing here re-renders twenty times a second.
  let sideMeter: (() => void) | null = null;
  void startSideMeter().then((stop) => {
    if (over) stop();
    else sideMeter = stop;
  });

  function drop() {
    const r = rec;
    rec = null;
    if (!r) return;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try {
      r.abort();
    } catch {
      // Already stopped.
    }
  }

  function end(then: () => void) {
    if (over) return;
    over = true;
    clearTimeout(pauseTimer);
    clearTimeout(quietTimer);
    drop();
    sideMeter?.();
    then();
  }

  function start() {
    if (!Ctor) return end(() => h.onError("no-voice"));
    const r = new Ctor();
    r.lang = "en-GB";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    // Each restart of the recogniser starts its results afresh: keep what came before.
    const before = heard;
    r.onresult = (e) => {
      if (over) return;
      const text = transcriptOf(e);
      if (!text) return;
      if (!heard.trim()) h.onSpeech?.();
      heard = before ? `${before} ${text}` : text;
      h.onWords?.(heard);
      clearTimeout(pauseTimer);
      pauseTimer = setTimeout(() => end(() => h.onDone(heard.trim())), pauseMs);
    };
    r.onerror = (e) => {
      if (over) return;
      if (meansNoVoiceHere(e.error, isIosHomeScreenApp())) {
        markRefused();
        return end(() => h.onError("no-voice"));
      }
      if (e.error === "not-allowed" || e.error === "audio-capture") {
        const code = e.error;
        return end(() => h.onError(code));
      }
      if (e.error === "network") return end(() => h.onError("failed"));
      // no-speech and aborted: onend decides.
    };
    r.onend = () => {
      if (over || rec !== r) return;
      rec = null;
      // Browsers stop on their own after a pause: finish with what was said, or listen on.
      if (heard.trim()) end(() => h.onDone(heard.trim()));
      else start();
    };
    rec = r;
    try {
      r.start();
    } catch {
      rec = null;
      end(() => h.onError("failed"));
    }
  }

  start();
  return {
    auto: true,
    finish: () => end(() => h.onDone(heard.trim())),
    cancel: () => end(() => {}),
  };
}

function recordedTurn(h: TurnHandlers, opts: TurnOptions): Turn {
  const quietMs = opts.quietMs ?? ANSWER_QUIET_MS;
  let over = false;
  let stopping = false;
  let recording: Recording | null = null;
  let spoke = false;
  let finishAsked = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  const turn = {
    auto: true,
    finish: () => void stop(),
    cancel() {
      if (over) return;
      over = true;
      clearTimeout(quietTimer);
      recording?.cancel();
      recording = null;
      releaseMic();
    },
  };

  async function stop() {
    if (over || stopping) return;
    if (!recording) {
      // Still starting: finish as soon as the microphone is on.
      finishAsked = true;
      return;
    }
    stopping = true;
    clearTimeout(quietTimer);
    const r = recording;
    recording = null;
    h.onLevel?.(0);
    const blob = await r.stop();
    // The microphone is off while Michael thinks and speaks: his voice is never recorded.
    releaseMic();
    if (over) return;
    if (!blob) {
      over = true;
      return h.onDone("");
    }
    h.onTranscribing?.();
    const res = await transcribeRecording(blob);
    if (over) return;
    over = true;
    if (!res.ok) return h.onError(res.code === "unavailable" ? "no-voice" : "failed");
    if (res.text) h.onWords?.(res.text);
    h.onDone(res.text);
  }

  startRecording({
    onLevel: (level) => {
      if (!over && !stopping) h.onLevel?.(level);
    },
    onSpeech: () => {
      if (over) return;
      spoke = true;
      clearTimeout(quietTimer);
      h.onSpeech?.();
    },
    onPause: () => void stop(),
    onLimit: () => void stop(),
  })
    .then((r) => {
      if (over) return r.cancel();
      recording = r;
      // Without a level there is no telling silence from speech: the user taps when done.
      turn.auto = r.metered;
      if (finishAsked) return void stop();
      if (r.metered) {
        quietTimer = setTimeout(() => {
          if (over || spoke) return;
          turn.cancel();
          h.onQuiet?.();
        }, quietMs);
      }
    })
    .catch((err: unknown) => {
      if (over) return;
      over = true;
      const code = err instanceof MicError ? err.code : "unknown";
      h.onError(code === "unknown" ? "failed" : code);
    });

  return turn;
}
