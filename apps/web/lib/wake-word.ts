import { useSyncExternalStore } from "react";

// "Michael" as a wake word, in the app only. While the app is open and visible, and the
// user has switched it on, the browser's own recogniser listens for his name; the name is matched
// here, on the transcript, in the browser. Nothing reaches Michael's API until he is woken: then
// the existing hands free conversation (components/voice/conversation.ts) takes over, with whatever
// followed the name as the first thing the user said. The listening loop is
// components/voice/wake-word-host.tsx; this file is the pure part (tested alone) and the small
// stores the host, the You switch and the chat share.

// ---------- matching (pure) ----------

/** Words people put before a name. "Yo Michael", "hey Michael", "ok Michael". */
const LEAD = "(?:(?:yo|hey|hi|oi|ok|okay|right)[\\s,.!?]+)?";
/**
 * His name as recognisers write it. Only spellings that are the name itself: "my call" or
 * "mike all" would wake him on ordinary sentences ("my call with Anna"), so they are left out.
 */
const NAME = "(?:michael|micheal|michel|mikael|mikhail|michal|mychal)";
// The name must end there: "Michaela" and "Michael's" are other things.
const WAKE = new RegExp(`^\\s*${LEAD}${NAME}(?=$|[\\s,.!?:;])[\\s,.!?:;]*(.*)$`, "i");

export type Wake = {
  /** What the user said after the name, ready to send; null when it was only the name. */
  first: string | null;
};

/**
 * The wake word at the start of one phrase, tolerant to case and punctuation. Returns what followed
 * it, or null when the phrase does not start with his name.
 */
export function matchWake(phrase: string): Wake | null {
  const m = WAKE.exec(phrase.replace(/\s+/g, " "));
  if (!m) return null;
  const rest = (m[1] ?? "").trim().replace(/^[\s,.!?:;]+/, "");
  if (!rest) return { first: null };
  return { first: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

type Segment = { isFinal: boolean; length: number; [index: number]: { transcript: string } };

/**
 * The newest phrase in a recogniser event that starts with his name, with whether the recogniser
 * has finished it. Each result is one phrase (Chrome splits on pauses; Android repeats the whole
 * phrase in each new result, which still starts with the name), so only the start of a phrase can
 * wake him, never a "Michael" in the middle of a sentence.
 */
export function wakeIn(e: {
  resultIndex: number;
  results: ArrayLike<Segment>;
}): { phrase: string; final: boolean } | null {
  for (let i = e.results.length - 1; i >= Math.max(0, e.resultIndex); i--) {
    const r = e.results[i];
    const phrase = (r?.[0]?.transcript ?? "").trim();
    if (phrase && matchWake(phrase)) return { phrase, final: r?.isFinal === true };
  }
  return null;
}

/** After the name, wait this long for the rest of the sentence before acting on an unfinished phrase. */
export const WAKE_SETTLE_MS = 900;

/** A listening session shorter than this, with nothing heard, counts as a failure for the backoff. */
export const SHORT_SESSION_MS = 2000;
/** Consecutive failures before the loop gives up until the app is opened again or the switch flips. */
export const MAX_FAILURES = 6;

/**
 * How long to wait before listening again. Browsers end a session on their own every minute or
 * so: that is not a failure, and the next one starts at once. Errors and sessions that end at once
 * back off (1, 2, 4, 8, 16, 32 seconds); past MAX_FAILURES it stops (null), so a recogniser that
 * keeps failing never spins the battery down.
 */
export function restartDelay(failures: number): number | null {
  if (failures <= 0) return 250;
  if (failures > MAX_FAILURES) return null;
  return Math.min(60_000, 1000 * 2 ** (failures - 1));
}

/** Errors that end listening for good until the user acts: no microphone, or no recogniser here. */
export function isFatalWakeError(code: string): boolean {
  return code === "not-allowed" || code === "service-not-allowed" || code === "language-not-supported";
}

/** Errors that are part of normal listening: silence, or our own abort. */
export function isQuietWakeError(code: string): boolean {
  return code === "no-speech" || code === "aborted";
}

// ---------- the setting, per device ----------

/**
 * Off, or on with the way recognition runs: on the device (Chrome's language pack, nothing leaves
 * the device) or the browser's speech service (cloud). The mode is part of the consent: if on
 * device listening goes away, the switch turns off rather than quietly sending audio to the cloud.
 */
export type WakeSetting = { mode: "off" } | { mode: "local" | "cloud"; lang: string };

const KEY = "michael.wake";
const OFF: WakeSetting = { mode: "off" };
let setting: WakeSetting | null = null;
/** Why it turned itself off (microphone refused, on device listening gone), for the switch row. */
let note: string | null = null;
const settingListeners = new Set<() => void>();

/** Reads a stored value; anything unexpected is off. */
export function parseSetting(raw: string | null): WakeSetting {
  if (!raw) return OFF;
  try {
    const v = JSON.parse(raw) as { mode?: unknown; lang?: unknown };
    if ((v.mode === "local" || v.mode === "cloud") && typeof v.lang === "string" && v.lang) {
      return { mode: v.mode, lang: v.lang };
    }
  } catch {
    // Not ours.
  }
  return OFF;
}

/** The reason kept with an off setting, so it is still there after a reload. */
export function parseNote(raw: string | null): string | null {
  try {
    const v = raw ? (JSON.parse(raw) as { mode?: unknown; note?: unknown }) : null;
    return v?.mode === "off" && typeof v.note === "string" ? v.note : null;
  } catch {
    return null;
  }
}

function load() {
  if (setting) return;
  try {
    const raw = window.localStorage.getItem(KEY);
    setting = parseSetting(raw);
    note = parseNote(raw);
  } catch {
    setting = OFF;
  }
}

export function readWakeSetting(): WakeSetting {
  load();
  return setting ?? OFF;
}

export function setWakeSetting(next: WakeSetting, why: string | null = null): void {
  setting = next;
  note = why;
  try {
    if (next.mode !== "off") window.localStorage.setItem(KEY, JSON.stringify(next));
    else if (why) window.localStorage.setItem(KEY, JSON.stringify({ mode: "off", note: why }));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode: on for this visit only.
  }
  for (const l of settingListeners) l();
}

export const readWakeNote = (): string | null => {
  load();
  return note;
};

function subscribeSetting(l: () => void) {
  settingListeners.add(l);
  return () => settingListeners.delete(l);
}

export function useWakeSetting(): WakeSetting {
  return useSyncExternalStore(subscribeSetting, readWakeSetting, () => OFF);
}

export function useWakeNote(): string | null {
  return useSyncExternalStore(subscribeSetting, readWakeNote, () => null);
}

// ---------- holds: other voice use pauses the wake word ----------

// Push to talk, Michael's own voice, a wake on its way to the conversation: while any of these
// holds, the wake word does not listen (two recognisers fight over the microphone, and Michael
// must never wake himself).
const holds = new Set<string>();
const holdListeners = new Set<() => void>();
let held = false;

export function setWakeHold(reason: string, on: boolean): void {
  if (on === holds.has(reason)) return;
  if (on) holds.add(reason);
  else holds.delete(reason);
  held = holds.size > 0;
  for (const l of holdListeners) l();
}

export const isWakeHeld = (): boolean => held;

/** For the listening loop itself: it lets go of the microphone in the same tick a hold starts. */
export function subscribeWakeHold(l: () => void): () => void {
  holdListeners.add(l);
  return () => holdListeners.delete(l);
}

export function useWakeHeld(): boolean {
  return useSyncExternalStore(
    (l) => {
      holdListeners.add(l);
      return () => holdListeners.delete(l);
    },
    () => held,
    () => false,
  );
}

// ---------- the wake, from the host to the chat ----------

// The host hears the name anywhere in the app; the conversation lives on Chat. The wake waits here
// until Chat is mounted (straight away when it already is) and takes it.
let pending: Wake | null = null;
const wakeListeners = new Set<() => void>();

export function emitWake(w: Wake): void {
  pending = w;
  for (const l of wakeListeners) l();
}

/** The wake not yet acted on, once: whoever takes it starts the conversation. */
export function takeWake(): Wake | null {
  const w = pending;
  pending = null;
  return w;
}

export function onWake(l: () => void): () => void {
  wakeListeners.add(l);
  return () => wakeListeners.delete(l);
}

/** Michael's line when woken by his name alone. */
export const READY_LINE = "Go on. I'm listening.";
