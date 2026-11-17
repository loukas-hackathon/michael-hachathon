"use client";

import { useSyncExternalStore } from "react";
import { sendLine } from "@/app/chat/chat-session";
import {
  checkRecorderPath,
  currentInputMode,
  MicError,
  primeRecorder,
  type Recording,
  releaseMic,
  startRecording,
  startSideMeter,
  transcribeErrorCopy,
  transcribeRecording,
} from "./recorder";
import {
  isEcho,
  isIos,
  isIosHomeScreenApp,
  markRefused,
  meansNoVoiceHere,
  type Recognition,
  recognitionCtor,
  recognitionErrorCopy,
  speakReply,
  stopSpeaking,
  transcriptOf,
  unlockAudio,
} from "./speech";

// A hands free conversation with Michael (#299): one tap starts it, he listens, answers briefly
// by voice, and listens again. Turn taking runs on the browser's own recogniser: a pause after
// the user's words ends their turn, a longer silence ends the conversation. Where the browser
// cannot recognise speech (an iPhone home screen app) or does it badly (iOS), each turn is
// recorded instead (#313): the microphone level ends the turn after a pause, and the API turns
// the recording into text and drops the audio. Tapping, or speaking
// over him where the device allows it, stops his voice. Kept outside React like the chat session,
// so the lines land in the same chat; the sheet only shows it.

export type Phase =
  /** Not started, or ended (by a tap or a long silence). */
  | "off"
  | "listening"
  /** The line is sent; Michael's answer streams in as captions. */
  | "thinking"
  | "speaking"
  /** The device cannot listen here: the sheet says so and offers the keyboard instead. */
  | "unavailable";

export type Conversation = {
  phase: Phase;
  /** What the user is saying, live. */
  heard: string;
  /** Why it ended or cannot run, in Michael's voice. Null when there is nothing to say. */
  note: string | null;
  /** Whether speaking over Michael stops him (off on iPhone, where the mic would cut his voice). */
  bargeIn: boolean;
  /** The turn is recorded and transcribed by the API, not recognised in the browser. */
  recorded: boolean;
  /** Microphone level 0..1 while a turn is recorded, for the orb. */
  level: number;
  /** The user muted the microphone: Michael still answers, but nothing is heard until unmuted. */
  muted: boolean;
};

/** A pause this long after the user's words ends their turn. */
export const TURN_PAUSE_MS = 1300;
/** Nothing said for this long while listening ends the conversation. */
export const QUIET_MS = 9000;
export const QUIET_COPY = "I'll be here when you need me.";

const OFF: Conversation = {
  phase: "off",
  heard: "",
  note: null,
  bargeIn: false,
  recorded: false,
  level: 0,
  muted: false,
};
let state = OFF;
const listeners = new Set<() => void>();

function set(patch: Partial<Conversation>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useConversation(): Conversation {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => OFF,
  );
}

let rec: Recognition | null = null;
// The living voice's level meter beside the recogniser (never while Michael speaks: it would hear him).
let sideMeter: (() => void) | null = null;
let recording: Recording | null = null;
let pauseTimer: ReturnType<typeof setTimeout> | undefined;
let quietTimer: ReturnType<typeof setTimeout> | undefined;
// Bumped whenever the conversation ends or a turn moves on, so late callbacks are ignored.
let gen = 0;
let elevenlabs = false;
// What Michael is saying, to tell his own voice from the user's.
let saying = "";
// When listening ends for want of words; kept across the browser's own restarts of the recogniser.
let quietAt = 0;

// Read fresh: the phase changes under an await, which TypeScript cannot see.
const phase = (): Phase => state.phase;

function clearTimers() {
  clearTimeout(pauseTimer);
  clearTimeout(quietTimer);
}

/** Stops the recogniser without letting its last events act. */
function dropRecogniser() {
  sideMeter?.();
  sideMeter = null;
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

/** Stops a turn's recording and throws it away, and turns the microphone off. */
function dropRecording() {
  recording?.cancel();
  recording = null;
  releaseMic();
}

/**
 * One tap starts it. Must run inside the tap: that is when iOS lets Michael's voice play later.
 * Woken by his name (lib/wake-word.ts) there is no tap: `first` is what the user said after the
 * name, answered at once; `greet` is his short ready line when they said only the name.
 */
export function startConversation(opts: { elevenlabs: boolean; first?: string; greet?: string }): void {
  elevenlabs = opts.elevenlabs;
  unlockAudio();
  // Inside the tap too: the level meter's audio context may only start in a gesture on iOS.
  primeRecorder();
  checkRecorderPath();
  const mode = currentInputMode();
  if (mode === "none") {
    set({ ...OFF, phase: "unavailable" });
    return;
  }
  const recorded = mode === "recorder";
  set({ ...OFF, recorded, bargeIn: !recorded && !isIos() });
  const first = opts.first?.trim();
  if (first) {
    const mine = ++gen;
    set({ phase: "thinking", heard: first });
    void answer(first, mine);
  } else if (opts.greet) {
    void greet(opts.greet, ++gen);
  } else {
    listen();
  }
}

/** His short ready line, then he listens: woken by his name alone. */
async function greet(line: string, mine: number) {
  saying = line;
  set({ phase: "speaking", heard: "" });
  await speakReply(line, elevenlabs);
  if (mine !== gen || phase() !== "speaking") return;
  listen();
}

/** Ends it now: no more listening, Michael stops mid sentence. */
export function endConversation(note: string | null = null): void {
  // Nothing running (the sheet unmounting after it ended): leave any other speech alone.
  if (state.phase === "off" || state.phase === "unavailable") {
    if (note !== state.note) set({ note });
    return;
  }
  gen++;
  clearTimers();
  dropRecogniser();
  dropRecording();
  stopSpeaking();
  set({ phase: "off", heard: "", note, level: 0 });
}

/** The big button: stops Michael and listens, ends the user's turn early, or starts again. */
export function tapConversation(): void {
  if (state.phase === "speaking") {
    gen++;
    stopSpeaking();
    dropRecogniser();
    listen();
  } else if (state.phase === "listening" && state.muted) {
    setMuted(false);
  } else if (state.phase === "listening" && state.recorded && recording) {
    // A recorded turn: a tap says "done" (the only way where the level cannot be read).
    void finishRecordedTurn();
  } else if (state.phase === "listening" && state.heard.trim()) {
    void finishTurn();
  } else if (state.phase === "off") {
    startConversation({ elevenlabs });
  }
}

/**
 * Mute: the microphone goes off (a turn half said is dropped) and stays off, also after Michael
 * answers, until unmuted. Michael still speaks. Unmuting listens again with a fresh quiet limit.
 */
export function setMuted(on: boolean): void {
  if (state.muted === on || state.phase === "off" || state.phase === "unavailable") return;
  if (on) {
    if (state.phase === "listening") {
      gen++;
      clearTimers();
    }
    // While he speaks only the barge in recogniser is dropped: his answer carries on.
    dropRecogniser();
    if (state.phase === "listening") dropRecording();
    set({ muted: true, heard: "", level: 0 });
    return;
  }
  set({ muted: false });
  if (state.phase === "listening") {
    quietAt = Date.now() + QUIET_MS;
    listen();
  } else if (state.phase === "speaking" && state.bargeIn) {
    listen(true);
  }
}

/**
 * Starts the recogniser. `overSpeech`: Michael is talking, so only a voice that is not his own
 * (barge in) counts, and it stops him.
 */
function listen(overSpeech = false) {
  if (state.muted) {
    // Muted: his turn is over, but nothing listens until the user unmutes.
    if (!overSpeech) {
      clearTimers();
      dropRecogniser();
      set({ phase: "listening", heard: "", level: 0 });
    }
    return;
  }
  if (state.recorded) {
    if (!overSpeech) listenRecorded();
    return;
  }
  const Ctor = recognitionCtor();
  if (!Ctor) return set({ phase: "unavailable" });
  const mine = gen;
  dropRecogniser();
  clearTimers();
  if (!overSpeech) {
    if (state.phase !== "listening") quietAt = Date.now() + QUIET_MS;
    set({ phase: "listening", heard: "" });
    quietTimer = setTimeout(
      () => {
        if (mine === gen && !state.heard.trim()) endConversation(QUIET_COPY);
      },
      Math.max(0, quietAt - Date.now()),
    );
  }
  let heard = "";
  const r = new Ctor();
  r.lang = "en-GB";
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    if (mine !== gen) return;
    const text = transcriptOf(e);
    if (overSpeech) {
      if (isEcho(text, saying)) return;
      // The user spoke over Michael: he stops, and a fresh turn starts (his echo left behind).
      gen++;
      stopSpeaking();
      dropRecogniser();
      listen();
      return;
    }
    heard = text;
    set({ heard });
    clearTimeout(quietTimer);
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      if (mine === gen) void finishTurn();
    }, TURN_PAUSE_MS);
  };
  r.onerror = (e) => {
    if (mine !== gen) return;
    if (meansNoVoiceHere(e.error, isIosHomeScreenApp())) {
      markRefused();
      endConversation();
      set({ phase: "unavailable", note: null });
      return;
    }
    if (e.error === "not-allowed" || e.error === "audio-capture") {
      endConversation(recognitionErrorCopy(e.error));
    }
    // no-speech, network and aborted: onend decides what happens next.
  };
  r.onend = () => {
    if (mine !== gen || rec !== r) return;
    rec = null;
    if (overSpeech) return;
    // Browsers stop listening on their own after a pause: finish the turn, or keep listening.
    if (heard.trim()) void finishTurn();
    else if (phase() === "listening") listen();
  };
  rec = r;
  try {
    r.start();
  } catch {
    rec = null;
    if (!overSpeech) endConversation(recognitionErrorCopy("unknown"));
    return;
  }
  if (!overSpeech) {
    void startSideMeter().then((stop) => {
      if (mine === gen && rec === r && !sideMeter) sideMeter = stop;
      else stop();
    });
  }
}

/** A recorded turn: listens until the user pauses after speaking, or taps. */
function listenRecorded() {
  const mine = gen;
  dropRecogniser();
  dropRecording();
  clearTimers();
  if (state.phase !== "listening") quietAt = Date.now() + QUIET_MS;
  set({ phase: "listening", heard: "", level: 0 });
  let spoke = false;
  startRecording({
    onLevel: (level) => {
      if (mine === gen) set({ level });
    },
    onSpeech: () => {
      spoke = true;
      clearTimeout(quietTimer);
    },
    onPause: () => {
      if (mine === gen) void finishRecordedTurn();
    },
    onLimit: () => {
      if (mine === gen) void finishRecordedTurn();
    },
  })
    .then((r) => {
      if (mine !== gen || state.phase !== "listening") return r.cancel();
      recording = r;
      // Without a level there is no telling silence from speech: the user taps when done.
      if (!r.metered) return;
      quietTimer = setTimeout(
        () => {
          if (mine === gen && !spoke) endConversation(QUIET_COPY);
        },
        Math.max(0, quietAt - Date.now()),
      );
    })
    .catch((err: unknown) => {
      if (mine !== gen) return;
      endConversation(recognitionErrorCopy(err instanceof MicError ? err.code : "unknown"));
    });
}

/** The recorded turn is over: the API turns it into text, then it goes like a spoken one. */
async function finishRecordedTurn() {
  const r = recording;
  recording = null;
  if (!r || state.phase !== "listening") return;
  const mine = ++gen;
  clearTimers();
  set({ phase: "thinking", level: 0 });
  const blob = await r.stop();
  // The microphone is off while Michael thinks and speaks: his voice is never recorded.
  releaseMic();
  if (mine !== gen) return;
  if (!blob) {
    set({ phase: "listening" });
    return listen();
  }
  const res = await transcribeRecording(blob);
  if (mine !== gen) return;
  if (!res.ok) return endConversation(transcribeErrorCopy(res.code));
  if (!res.text) {
    // Only noise: keep listening, within the same quiet limit.
    set({ phase: "listening" });
    return listen();
  }
  set({ heard: res.text });
  await answer(res.text, mine);
}

/** The user's turn is over: send it, show the answer as it streams, then say it and listen again. */
async function finishTurn() {
  const text = state.heard.trim();
  if (!text || state.phase !== "listening") return;
  const mine = ++gen;
  clearTimers();
  dropRecogniser();
  set({ phase: "thinking" });
  await answer(text, mine);
}

async function answer(text: string, mine: number) {
  const res = await sendLine(text, { spoken: true });
  if (mine !== gen) return;
  if (!res) return endConversation();
  saying = res.ok ? res.reply : res.error;
  set({ phase: "speaking", heard: "" });
  if (state.bargeIn) listen(true);
  await speakReply(saying, res.ok && elevenlabs);
  if (mine !== gen || phase() !== "speaking") return;
  // One calm line stays on screen for what went wrong (no network, a refusal); he has just said it.
  if (!res.ok) return endConversation(res.error);
  listen();
}
