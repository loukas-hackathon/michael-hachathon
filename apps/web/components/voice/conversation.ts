"use client";

import { useSyncExternalStore } from "react";
import { sendLine } from "@/app/chat/chat-session";
import { hapticTwice } from "@/components/haptics";
import { micBlockedLine, traceVoice } from "@/lib/wake-word";
import { playEarcon } from "./earcons";
import {
  checkRecorderPath,
  currentInputMode,
  MicError,
  primeRecorder,
  type Recording,
  releaseMic,
  resetVoiceAudio,
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
  /**
   * Woken by his name ("Yo Michael", components/voice/wake-island.tsx), not started from the
   * sheet: shorter pauses and silences, misses said out loud, and it closes quietly.
   */
  wake: boolean;
  /** Answers given in this conversation (0 while the first request is still being made). */
  turns: number;
  /** Turns heard with no words in them, woken by name: one is said, the second offers typing. */
  misses: number;
  /**
   * Held: the Mi button is pressed and held (hold-to-talk.ts), like the side button for Siri. He
   * listens for as long as it is held, with no pause or quiet limit, answers once it is let go, and
   * does not listen again: the next hold is the next question.
   */
  hold: boolean;
};

/** A pause this long after the user's words ends their turn. */
export const TURN_PAUSE_MS = 1300;
/** Nothing said for this long while listening ends the conversation. */
export const QUIET_MS = 9000;
export const QUIET_COPY = "I'll be here when you need me.";

// Woken by name, a one shot request should feel like Siri: the turn ends on a shorter pause, an
// unused wake closes sooner, and after his answer a short window lets the user follow up.
/** End of the first turn after a wake. */
export const WAKE_PAUSE_MS = 1000;
/** Nothing said this long after a wake: it closes, quietly, with no line. */
export const WAKE_QUIET_MS = 4000;
/** After his answer, this long to follow up before it closes. */
export const FOLLOW_UP_MS = 5000;
export const MISSED_COPY = "I didn't catch that. Say it again.";
export const TYPE_COPY = "Type it instead.";
export const WAKE_MIC_COPY = "I can't hear you. Allow the microphone in Settings.";
export const OFFLINE_COPY = "No connection. I'll answer when you're back.";
/** Held: let go before anything was recorded. */
export const HOLD_SHORT_COPY = "Hold me while you speak, then let go.";
/** Held: let go with no words in it. */
export const HOLD_MISSED_COPY = "I didn't catch that. Hold me and speak.";
/** Held: the recogniser has this long after the release to hand over its last words. */
const RELEASE_GRACE_MS = 1500;

const OFF: Conversation = {
  phase: "off",
  heard: "",
  note: null,
  bargeIn: false,
  recorded: false,
  level: 0,
  muted: false,
  wake: false,
  turns: 0,
  misses: 0,
  hold: false,
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
// Held: the Mi button has been let go, so the turn ends as soon as the last words are in.
let released = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

/** Woken by name: the island shows it, not the sheet (which leaves it running when it unmounts). */
export const isWakeConversation = (): boolean => state.wake && state.phase !== "off";
/** The phase now, for callbacks that must not read a stale render. */
export const conversationPhase = (): Phase => state.phase;

// Read fresh: the phase changes under an await, which TypeScript cannot see.
const phase = (): Phase => state.phase;

function clearTimers() {
  clearTimeout(pauseTimer);
  clearTimeout(quietTimer);
  clearTimeout(releaseTimer);
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
export function startConversation(opts: {
  elevenlabs: boolean;
  first?: string;
  greet?: string;
  /** Woken by name: the island's timings and lines (see Conversation.wake). */
  wake?: boolean;
  /** Held on the Mi button: listens until releaseHold (see Conversation.hold). */
  hold?: boolean;
}): void {
  elevenlabs = opts.elevenlabs;
  released = false;
  // A new hold cuts in on whatever he was saying, and on anything left half done: a turn that never
  // finished (a microphone that never opened, a reply that never ended) can never block the next.
  if (opts.hold) {
    stopSpeaking();
    gen++;
    clearTimers();
    dropRecogniser();
    dropRecording();
  }
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
  const hold = opts.hold === true;
  if (hold) traceVoice(`hold, ${recorded ? "recorded for the API" : "browser recogniser"}`);
  set({
    ...OFF,
    recorded,
    bargeIn: !recorded && !isIos() && !hold,
    wake: opts.wake === true || hold,
    hold,
  });
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
    stopSpeaking({ fade: true });
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
  // Held: the browser may end a session mid hold; the words so far stay and the next adds to them.
  const before = state.hold ? state.heard.trim() : "";
  if (!overSpeech) {
    if (state.phase !== "listening") quietAt = Date.now() + quietMs();
    set({ phase: "listening", heard: before });
    // Held, there is no quiet limit: the hand on the button says when it is over.
    if (!state.hold) {
      quietTimer = setTimeout(
        () => {
          if (mine === gen && !state.heard.trim()) endConversation(quietNote());
        },
        Math.max(0, quietAt - Date.now()),
      );
    }
  }
  let heard = before;
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
      stopSpeaking({ fade: true });
      dropRecogniser();
      listen();
      return;
    }
    heard = before && text ? `${before} ${text}` : before || text;
    set({ heard, note: null });
    clearTimeout(quietTimer);
    clearTimeout(pauseTimer);
    // Held, a pause does not end the turn: letting go does.
    if (state.hold) return;
    pauseTimer = setTimeout(() => {
      if (mine === gen) void finishTurn();
    }, pauseMs());
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
      endConversation(micCopy(e.error));
      return;
    }
    // Speech, but no words in it: said once when woken by name, then typing is offered. Held, the
    // release decides.
    if (e.error === "no-match" && !overSpeech && !state.hold) missed(mine);
    // no-speech, network and aborted: onend decides what happens next.
  };
  r.onend = () => {
    if (mine !== gen || rec !== r) return;
    rec = null;
    if (overSpeech) return;
    if (state.hold) {
      // Let go: the last words are in. Still held: the browser ended the session, listen on.
      if (released) return void finishHeld();
      if (phase() === "listening") listen();
      return;
    }
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
  if (state.phase !== "listening") quietAt = Date.now() + quietMs();
  set({ phase: "listening", heard: "", level: 0 });
  const held = state.hold;
  let spoke = false;
  const opening = Date.now();
  startRecording({
    onLevel: (level) => {
      if (mine === gen) set({ level });
    },
    onSpeech: () => {
      spoke = true;
      clearTimeout(quietTimer);
    },
    onPause: () => {
      // Held, a pause is only a breath: letting go ends the turn.
      if (mine === gen && !held) void finishRecordedTurn();
    },
    onLimit: () => {
      if (mine === gen) void finishRecordedTurn();
    },
  })
    .then((r) => {
      if (mine !== gen || state.phase !== "listening") return r.cancel();
      traceVoice(`mic open in ${Date.now() - opening} ms${r.metered ? "" : ", no meter"}`);
      recording = r;
      // Let go while the microphone was still opening: the turn ends now.
      if (held) {
        if (released) void finishRecordedTurn();
        return;
      }
      // Without a level there is no telling silence from speech: the user taps when done.
      if (!r.metered) return;
      quietTimer = setTimeout(
        () => {
          if (mine === gen && !spoke) endConversation(quietNote());
        },
        Math.max(0, quietAt - Date.now()),
      );
    })
    .catch((err: unknown) => {
      if (mine !== gen) return;
      const code = err instanceof MicError ? err.code : "unknown";
      traceVoice(`mic failed: ${code}`);
      resetVoiceAudio();
      endConversation(micCopy(code));
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
  traceVoice(blob ? `recorded ${Math.round(blob.size / 1024)} KB ${blob.type}` : "recorded nothing");
  if (!blob) {
    // Nothing came out of the recorder: the next hold opens a fresh microphone.
    resetVoiceAudio();
    if (state.hold) return heldMiss(HOLD_SHORT_COPY);
    set({ phase: "listening" });
    return listen();
  }
  const res = await transcribeRecording(blob);
  if (mine !== gen) return;
  traceVoice(res.ok ? `heard: "${res.text}"` : `transcribe failed: ${res.code}`);
  if (!res.ok) {
    resetVoiceAudio();
    return endConversation(transcribeErrorCopy(res.code));
  }
  if (!res.text && state.hold) return heldMiss(HOLD_MISSED_COPY);
  if (!res.text) {
    // Only noise: keep listening, within the same quiet limit (woken by name, it says so once).
    if (missed(mine)) return;
    set({ phase: "listening" });
    return listen();
  }
  set({ heard: res.text, note: null });
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
  traceVoice(!res ? "no answer" : res.ok ? "answered" : `answer failed: ${res.error}`);
  if (!res) return endConversation();
  // Woken by name and offline: the line says so plainly, as the island shows it.
  const error =
    !res.ok && state.wake && typeof navigator !== "undefined" && !navigator.onLine ? OFFLINE_COPY : null;
  saying = res.ok ? res.reply : (error ?? res.error);
  set({ phase: "speaking", heard: "", turns: state.turns + 1, misses: 0 });
  if (state.bargeIn) listen(true);
  await speakReply(saying, res.ok && elevenlabs);
  if (mine === gen) traceVoice("said it");
  if (mine !== gen || phase() !== "speaking") return;
  // One calm line stays on screen for what went wrong (no network, a refusal); he has just said it.
  if (!res.ok) return endConversation(saying);
  // Held: one question, one answer. The answer stays on screen; the next hold asks again.
  if (state.hold) return endConversation();
  listen();
}

/**
 * The Mi button was let go: the turn ends once its last words are in. A recording stops and goes
 * to the API; the browser's recogniser is asked to stop, and its end hands over the final words
 * (with a short grace in case a browser never says it has ended).
 */
export function releaseHold(): void {
  if (!state.hold || released) return;
  released = true;
  // The release is a tap: the moment iOS lets his voice be unlocked for the reply.
  unlockAudio();
  if (state.phase !== "listening") return;
  if (state.recorded) {
    // Still opening the microphone: listenRecorded ends the turn once it has it.
    if (recording) void finishRecordedTurn();
    return;
  }
  const r = rec;
  if (!r) return void finishHeld();
  const mine = gen;
  releaseTimer = setTimeout(() => {
    if (mine === gen && state.phase === "listening") {
      dropRecogniser();
      void finishHeld();
    }
  }, RELEASE_GRACE_MS);
  try {
    r.stop();
  } catch {
    dropRecogniser();
    void finishHeld();
  }
}

/** Held and let go, by the recogniser: send what was said, or say nothing was caught. */
async function finishHeld() {
  clearTimeout(releaseTimer);
  if (state.phase !== "listening") return;
  if (state.heard.trim()) return finishTurn();
  heldMiss(HOLD_MISSED_COPY);
}

/** Held, nothing to send: two ticks, the missed earcon, and the line stays on the island. */
function heldMiss(copy: string) {
  hapticTwice();
  playEarcon("missed");
  endConversation(copy);
}

/** The quiet limit for the listening that starts now: shorter after a wake, the follow up after an answer. */
function quietMs(): number {
  if (!state.wake) return QUIET_MS;
  return state.turns === 0 ? WAKE_QUIET_MS : FOLLOW_UP_MS;
}

/** A wake that goes quiet closes with no line; the sheet's conversation says it will be there. */
const quietNote = (): string | null => (state.wake ? null : QUIET_COPY);

/** The pause that ends a turn: shorter for the one shot request after a wake. */
const pauseMs = (): number => (state.wake && state.turns === 0 ? WAKE_PAUSE_MS : TURN_PAUSE_MS);

/** The line for a microphone that will not open, in the island's words when woken by name. */
/** The microphone did not open in time (iOS can leave it pending after the app was away). */
export const MIC_TIMEOUT_COPY = "The microphone didn't open. Hold me again.";

function micCopy(code: string): string | null {
  if (code === "timeout") return MIC_TIMEOUT_COPY;
  if (state.wake && (code === "not-allowed" || code === "service-not-allowed")) {
    return typeof navigator === "undefined" ? WAKE_MIC_COPY : micBlockedLine(navigator.userAgent);
  }
  return recognitionErrorCopy(code);
}

/**
 * Woken by name, a turn came back with no words in it. The first time he says so (on screen and
 * aloud, two ticks and the missed earcon, before the microphone opens again) and listens once more;
 * the second time he offers typing and closes. Returns whether it handled the miss.
 */
function missed(mine: number): boolean {
  if (!state.wake || mine !== gen) return false;
  const misses = state.misses + 1;
  // The ticks and the earcon play before listening restarts: never while a sentence is recorded.
  hapticTwice();
  playEarcon("missed");
  if (misses >= 2) {
    endConversation(TYPE_COPY);
    set({ misses });
    void speakReply(TYPE_COPY, elevenlabs);
    return true;
  }
  clearTimers();
  dropRecogniser();
  dropRecording();
  set({ misses, note: MISSED_COPY });
  void greet(MISSED_COPY, ++gen);
  return true;
}
