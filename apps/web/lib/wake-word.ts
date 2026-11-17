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
  /**
   * Held, not spoken: the Mi button is pressed and held (components/voice/hold-to-talk.ts). He
   * listens while it is held and answers once it is let go.
   */
  hold?: boolean;
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

/** A listening session shorter than this, with nothing heard, counts as a quick end. */
export const SHORT_SESSION_MS = 2000;
/** Consecutive failures before the loop gives up until the app is opened again or the switch flips. */
export const MAX_FAILURES = 6;
/**
 * The gap between one listening session and the next after the browser ends one on its own.
 * Safari ends sessions every few seconds and Chrome after about a minute: the next starts well
 * inside 300ms, so a name said straight after is heard by the new one.
 */
export const RESTART_MS = 100;
/**
 * Quick clean ends (no error, nothing heard, under SHORT_SESSION_MS) that still restart at once.
 * iPhone Safari ends some sessions within a second or two of silence: that is how it listens, not a
 * failure, so only a long run of them backs off.
 */
export const QUICK_FREE = 4;

/**
 * How long to wait before listening again. Browsers end a session on their own every minute or
 * so: that is not a failure, and the next one starts at once. Errors and sessions that end at once
 * back off (1, 2, 4, 8, 16, 32 seconds); past MAX_FAILURES it stops (null), so a recogniser that
 * keeps failing never spins the battery down.
 */
export function restartDelay(failures: number): number | null {
  if (failures <= 0) return RESTART_MS;
  if (failures > MAX_FAILURES) return null;
  return Math.min(60_000, 1000 * 2 ** (failures - 1));
}

export type LoopCount = { failures: number; quick: number };

/**
 * What one session's end means for the next: errors back off at once; quick clean ends restart at
 * once for the first QUICK_FREE in a row, then back off as errors do; a session that heard
 * something or ran its course resets both counts. `delay` null: rest until the app is opened again.
 */
export function nextRestart(
  count: LoopCount,
  end: { errored: boolean; short: boolean },
): LoopCount & { delay: number | null } {
  if (end.errored) {
    const failures = count.failures + 1;
    return { failures, quick: count.quick, delay: restartDelay(failures) };
  }
  if (end.short) {
    const quick = count.quick + 1;
    const over = Math.max(0, quick - QUICK_FREE);
    return { failures: count.failures, quick, delay: restartDelay(over) };
  }
  return { failures: 0, quick: 0, delay: RESTART_MS };
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

// ---------- the wake, from the host to the island ----------

// The host hears the name anywhere in the app; Michael answers in the island at the top of the
// screen (components/voice/wake-island.tsx), which is mounted once in the root layout and takes it.
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

// ---------- armed and heard: the quiet signs before a wake ----------

/** A small store of one boolean, read with useSyncExternalStore. */
function flag() {
  let value = false;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    set(next: boolean) {
      if (next === value) return;
      value = next;
      for (const l of listeners) l();
    },
    get: () => value,
    use: () =>
      useSyncExternalStore(
        subscribe,
        () => value,
        () => false,
      ),
  };
}

// Armed: the wake word is listening for the name right now. The Mi button shows a still ring
// (the privacy sign); it goes in the same frame listening stops.
const armed = flag();
export const setWakeArmed = armed.set;
export const useWakeArmed = armed.use;

// Heard: the recogniser has the name in an unfinished phrase. The island comes in at 60% with no
// bloom and no sound, and either opens fully when the phrase is confirmed or fades away.
const heard = flag();
export const setWakeHeard = heard.set;
export const isWakeHeard = heard.get;
export const useWakeHeard = heard.use;

// ---------- where it can work (pure) ----------

/** What decides whether "Yo Michael" can run on this device, read in the browser. */
export type WakeEnv = {
  /** The browser has a speech recogniser (SpeechRecognition or webkitSpeechRecognition). */
  recognition: boolean;
  /** It refused to run here before (remembered per device, components/voice/speech.ts). */
  refused: boolean;
  /** An app added to the iPhone Home Screen: iOS refuses web speech recognition there. */
  iosHomeScreen: boolean;
  /** The microphone permission as the browser reports it; "unknown" where it cannot say. */
  mic: "granted" | "denied" | "prompt" | "unknown";
};

export type WakeSupport = "ok" | "home-screen" | "no-recogniser" | "mic-blocked";

export function wakeSupport(env: WakeEnv): WakeSupport {
  if (env.iosHomeScreen) return "home-screen";
  if (!env.recognition || env.refused) return "no-recogniser";
  if (env.mic === "denied") return "mic-blocked";
  return "ok";
}

export const HOME_SCREEN_LINE =
  "On iPhone, hold the Mi button to talk. Saying my name needs Safari or Chrome.";
export const NO_RECOGNISER_LINE = "This browser can't listen for my name. Hold the Mi button to talk.";

/** How to let the microphone back in, in one line, for the browser in front of the user. */
export function micBlockedLine(ua: string): string {
  const ios = /iPhone|iPad|iPod/.test(ua);
  if (ios && /CriOS/.test(ua)) return "Microphone blocked. Allow it in Settings, Apps, Chrome, Microphone.";
  if (ios) return "Microphone blocked. Tap aA in the address bar, Website Settings, Microphone, Allow.";
  if (/Firefox\//.test(ua)) return "Microphone blocked. Click the icon left of the address and allow it.";
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) {
    const verb = /Android/.test(ua) ? "Tap" : "Click";
    return `Microphone blocked. ${verb} the icon left of the address and allow it.`;
  }
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) {
    return "Microphone blocked. In the Safari menu, open Settings for this website and allow it.";
  }
  return "Microphone blocked. Allow it for this site in your browser settings.";
}

/** The one line that says why "Yo Michael" cannot run here and what to do; null when it can. */
export function supportLine(support: WakeSupport, ua: string): string | null {
  if (support === "home-screen") return HOME_SCREEN_LINE;
  if (support === "no-recogniser") return NO_RECOGNISER_LINE;
  if (support === "mic-blocked") return micBlockedLine(ua);
  return null;
}

// ---------- the offer: asked once, at the right moment ----------

/**
 * Michael offers "Yo Michael" once: the first time Chat opens, or on Today once the user has had
 * him for a day and never opened Chat. Where saying his name cannot work, he offers holding the Mi
 * button instead; where the microphone is blocked, he says how to allow it. After any choice,
 * never again on this device.
 */
export type OfferChoice = "on" | "no";
export type OfferKind = "wake" | "hold" | "blocked";
export const DAY_MS = 24 * 60 * 60 * 1000;

export function offerKind(o: {
  place: "chat" | "today";
  choice: OfferChoice | null;
  wakeOn: boolean;
  chatOpened: boolean;
  firstSeen: number | null;
  now: number;
  support: WakeSupport;
}): OfferKind | null {
  if (o.choice || o.wakeOn) return null;
  if (o.place === "today" && (o.chatOpened || o.firstSeen === null || o.now - o.firstSeen < DAY_MS)) {
    return null;
  }
  if (o.support === "ok") return "wake";
  if (o.support === "mic-blocked") return "blocked";
  return "hold";
}

export const OFFER_WAKE_LINE = "Want to just say my name to talk to me?";
export const OFFER_ON_LINE = "On. Say my name any time the app is open.";
export const OFFER_HOLD_ON_LINE = "Ready. Hold the Mi button and talk.";

const OFFER_KEY = "michael.wake.offer";
const SEEN_KEY = "michael.firstSeen";
const CHAT_KEY = "michael.chatOpened";

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode: for this visit only.
  }
}

export function readOfferChoice(): OfferChoice | null {
  const v = readKey(OFFER_KEY);
  return v === "on" || v === "no" ? v : null;
}

export function setOfferChoice(choice: OfferChoice): void {
  writeKey(OFFER_KEY, choice);
}

/** When this device first opened Today or Chat, set on the first call. */
export function firstSeen(now: number): number {
  const v = Number(readKey(SEEN_KEY));
  if (Number.isFinite(v) && v > 0) return v;
  writeKey(SEEN_KEY, String(now));
  return now;
}

export const readChatOpened = (): boolean => readKey(CHAT_KEY) === "1";
export const markChatOpened = (): void => writeKey(CHAT_KEY, "1");

// ---------- the diagnostic (?debug=voice) ----------

/** What the listening loop last did, for the founder to debug on his phone. */
export type WakeDebug = {
  /** The last words the recogniser heard, wake or not. */
  heard: string;
  heardAt: number;
  /** Listening sessions started since the page loaded. */
  sessions: number;
  /** How the last session ended: "end", or the error code. */
  lastEnd: string;
  /** From the last end to the next start, in ms. */
  gapMs: number | null;
  /** The last steps of a hold or a turn ("mic open 420 ms", "sent 38 KB", "heard: ..."), newest last. */
  steps: string[];
};

let debug: WakeDebug = { heard: "", heardAt: 0, sessions: 0, lastEnd: "", gapMs: null, steps: [] };
const debugListeners = new Set<() => void>();

export function noteWakeDebug(patch: Partial<WakeDebug>): void {
  debug = { ...debug, ...patch };
  for (const l of debugListeners) l();
}

export const readWakeDebug = (): WakeDebug => debug;

/** One step of a voice turn for the diagnostic, with the time of day; keeps the last 12. */
export function traceVoice(step: string): void {
  const t = new Date();
  const at = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
  noteWakeDebug({ steps: [...debug.steps, `${at} ${step}`].slice(-12) });
}

export function useWakeDebug(): WakeDebug {
  return useSyncExternalStore(
    (l) => {
      debugListeners.add(l);
      return () => debugListeners.delete(l);
    },
    () => debug,
    () => debug,
  );
}

/** The diagnostic shows with ?debug=voice in the address, and stays on for the visit. */
export function wantsVoiceDebug(search: string, remembered: boolean): boolean {
  const v = new URLSearchParams(search).get("debug");
  if (v === "voice") return true;
  if (v === "off") return false;
  return remembered;
}
