"use client";

import { useSyncExternalStore } from "react";
import { sendLine } from "@/app/chat/chat-session";
import {
  isEcho,
  isIos,
  isIosHomeScreenApp,
  markRefused,
  meansNoVoiceHere,
  type Recognition,
  readRefused,
  recognitionCtor,
  recognitionErrorCopy,
  speakReply,
  stopSpeaking,
  transcriptOf,
  unlockAudio,
} from "./speech";

// A hands free conversation with Michael (#299): one tap starts it, he listens, answers briefly
// by voice, and listens again. Turn taking runs on the browser's own recogniser: a pause after
// the user's words ends their turn, a longer silence ends the conversation. Tapping, or speaking
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
};

/** A pause this long after the user's words ends their turn. */
export const TURN_PAUSE_MS = 1300;
/** Nothing said for this long while listening ends the conversation. */
export const QUIET_MS = 9000;
export const QUIET_COPY = "I'll be here when you need me.";

const OFF: Conversation = { phase: "off", heard: "", note: null, bargeIn: false };
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

/** One tap starts it. Must run inside the tap: that is when iOS lets Michael's voice play later. */
export function startConversation(opts: { elevenlabs: boolean }): void {
  elevenlabs = opts.elevenlabs;
  unlockAudio();
  if (!recognitionCtor() || readRefused()) {
    set({ ...OFF, phase: "unavailable" });
    return;
  }
  set({ ...OFF, bargeIn: !isIos() });
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
  stopSpeaking();
  set({ phase: "off", heard: "", note });
}

/** The big button: stops Michael and listens, ends the user's turn early, or starts again. */
export function tapConversation(): void {
  if (state.phase === "speaking") {
    gen++;
    stopSpeaking();
    dropRecogniser();
    listen();
  } else if (state.phase === "listening" && state.heard.trim()) {
    void finishTurn();
  } else if (state.phase === "off") {
    startConversation({ elevenlabs });
  }
}

/**
 * Starts the recogniser. `overSpeech`: Michael is talking, so only a voice that is not his own
 * (barge in) counts, and it stops him.
 */
function listen(overSpeech = false) {
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
  }
}

/** The user's turn is over: send it, show the answer as it streams, then say it and listen again. */
async function finishTurn() {
  const text = state.heard.trim();
  if (!text || state.phase !== "listening") return;
  const mine = ++gen;
  clearTimers();
  dropRecogniser();
  set({ phase: "thinking" });
  const res = await sendLine(text, { spoken: true });
  if (mine !== gen) return;
  if (!res) return endConversation();
  saying = res.ok ? res.reply : res.error;
  set({ phase: "speaking", heard: "" });
  if (state.bargeIn) listen(true);
  await speakReply(saying, res.ok && elevenlabs);
  if (mine !== gen || phase() !== "speaking") return;
  if (!res.ok) return endConversation();
  listen();
}
