// Browser speech in and out for push to talk. Recognition runs in the browser (Web Speech API);
// Michael only ever receives text. Where it cannot run, recorder.ts records the sentence for the
// API to transcribe; that audio is dropped once it is text.

import { setWakeHold } from "../../lib/wake-word";

// ---------- speech in ----------

// Not in TypeScript's DOM lib yet: the small part of the Web Speech API we use.
type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; length: number; [index: number]: RecognitionAlternative };
export type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
export type RecognitionErrorEvent = { error: string };

export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

/** SpeechRecognition, or webkitSpeechRecognition on Safari (iOS and Mac). Null when unsupported. */
export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * All text heard so far, final and interim, in order. Chrome on Android repeats the whole phrase
 * in each new result in continuous mode ("how", "how much", "how much deep"), so a piece that
 * already starts with everything before it replaces it instead of being added.
 */
export function transcriptOf(e: RecognitionEvent): string {
  let text = "";
  for (let i = 0; i < e.results.length; i++) {
    const piece = (e.results[i]?.[0]?.transcript ?? "").replace(/\s+/g, " ");
    const sofar = text.trim().toLowerCase();
    const whole = piece.trim().toLowerCase();
    text = sofar && whole.length > sofar.length && whole.startsWith(sofar) ? piece : text + piece;
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Michael's line for each way recognition can fail. Null when it is not worth saying. */
export function recognitionErrorCopy(code: string): string | null {
  if (code === "not-allowed" || code === "service-not-allowed")
    return "I need the microphone. Allow it in your browser settings, or type instead.";
  if (code === "no-speech") return "I didn't catch that. Hold the button and speak.";
  if (code === "audio-capture") return "I can't find a microphone. Type instead.";
  if (code === "network") return "Voice needs a connection. Type instead.";
  if (code === "aborted") return null;
  return "Voice stopped working. Type instead.";
}

export const UNSUPPORTED_COPY = "Voice needs Safari or Chrome. Type to me instead.";
/** Phones always have the keyboard's own dictation, even where the app cannot listen. */
export const DICTATE_COPY = "Tap the mic on your keyboard to dictate.";

/**
 * An app added to the iPhone home screen. Many iOS versions expose webkitSpeechRecognition there
 * but refuse to run it ("service-not-allowed"), so a refusal there means "no voice here", not
 * "the microphone is off".
 */
export function isIosHomeScreenApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** A touch screen with an on screen keyboard, where keyboard dictation is one tap away. */
export function hasTouchKeyboard(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

/**
 * True when this error means recognition cannot run in this browser at all, as opposed to a one
 * off failure: the button then turns into the keyboard dictation hint.
 */
export function meansNoVoiceHere(code: string, iosHomeScreen: boolean): boolean {
  if (code === "service-not-allowed") return true;
  // In a home screen app iOS reports its refusal as not-allowed too; dictation still works there.
  return iosHomeScreen && code === "not-allowed";
}

// Set once recognition has refused to run in this browser (an iPhone home screen app, mostly), so
// the mic stays the dictation hint instead of failing on every press. Remembered per device.
const REFUSED_KEY = "michael.voice.refused";
let refused: boolean | null = null;
const refusedListeners = new Set<() => void>();

export function readRefused(): boolean {
  if (refused === null) {
    try {
      refused = localStorage.getItem(REFUSED_KEY) === "1";
    } catch {
      refused = false;
    }
  }
  return refused;
}

export function markRefused(): void {
  refused = true;
  try {
    localStorage.setItem(REFUSED_KEY, "1");
  } catch {
    // Private mode: remembered for this visit only.
  }
  for (const l of refusedListeners) l();
}

export function subscribeRefused(l: () => void): () => void {
  refusedListeners.add(l);
  return () => refusedListeners.delete(l);
}

/** iPhone or iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(" ")
    .filter(Boolean);

/**
 * True when what the microphone heard is Michael's own voice coming back from the speaker: most of
 * its words are in what he is saying. Used so his voice does not interrupt himself.
 */
export function isEcho(heard: string, saying: string): boolean {
  const said = new Set(words(saying));
  const h = words(heard);
  if (!h.length) return true;
  const inSaid = h.filter((w) => said.has(w)).length;
  return inSaid / h.length >= 0.75;
}

// ---------- speech out ----------

/**
 * Michael's reply as words to say: the chat's light markdown (**bold**, "-" and "1." lists) would
 * otherwise be read out as "asterisk" or "dash" by some voices. Each line ends as a sentence.
 */
export function speakable(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/[*_`#]+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`))
    .join(" ");
}

/**
 * Sentences grouped into pieces of at most `max` characters. Chrome stops a long utterance after
 * about 15 seconds, so a long reply is queued as several short ones.
 */
export function speechChunks(text: string, max = 180): string[] {
  // A stop followed by a space ends a sentence; "1.5 hours" stays whole. No lookbehind: Safari
  // before 16.4 cannot parse one, and a parse error would take the whole chat screen down.
  const sentences = text
    .replace(/([.!?])\s+/g, "$1\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    const last = out.at(-1);
    if (last && last.length + 1 + sentence.length <= max) out[out.length - 1] = `${last} ${sentence}`;
    else out.push(sentence);
  }
  return out;
}

// A low, calm British man first; then any British voice that is not known to be female.
const MALE = /\b(daniel|arthur|oliver|george|harry|rishi|ryan|thomas|alfie|malcolm|male)\b/i;
const FEMALE =
  /\b(female|serena|kate|stephanie|martha|libby|sonia|hazel|susan|fiona|moira|tessa|karen|samantha|victoria|zira|catherine|emily|amy|emma)\b/i;

export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const isGb = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase().startsWith("en-gb");
  const isEn = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().startsWith("en");
  const male = (v: SpeechSynthesisVoice) => MALE.test(v.name) && !FEMALE.test(v.name);
  const gb = voices.filter(isGb);
  return (
    gb.find(male) ??
    gb.find((v) => !FEMALE.test(v.name)) ??
    gb[0] ??
    voices.find((v) => isEn(v) && male(v)) ??
    voices.find(isEn)
  );
}

let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let silent: string | null = null;

// A 1 sample silent WAV: played inside the user's tap so iOS lets us play the reply later.
function silentWav(): string {
  const buf = new ArrayBuffer(46);
  const v = new DataView(buf);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 38, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** Call inside the press: silences Michael mid sentence and gets the voices loading. */
export function primeSpeech(): void {
  stopSpeaking();
  if ("speechSynthesis" in window) {
    // Safari loads voices lazily; asking once early means they are ready when the reply lands.
    window.speechSynthesis.getVoices();
  }
}

/**
 * Call inside the release (pointerup or keyup count as a tap in every browser; iOS does not treat
 * a touchstart as one). iOS only lets a page make sound later if it made some inside a tap: one
 * silent sample for the audio element (ElevenLabs) and one silent utterance for the browser voice,
 * which is what speaks the reply seconds later, after the answer has streamed in. Done once the
 * microphone is stopping, so it never competes with the recording.
 */
export function unlockAudio(): void {
  try {
    audio ??= new Audio();
    silent ??= silentWav();
    audio.src = silent;
    void audio.play().catch(() => {});
  } catch {
    // No audio element (very old browser): the browser voice still works.
  }
  if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
    const hush = new SpeechSynthesisUtterance(" ");
    hush.volume = 0;
    window.speechSynthesis.speak(hush);
  }
}

// Each word the browser voice says, so the conversation's mark can pulse with it.
const beats = new Set<() => void>();
export function onSpeechBeat(l: () => void): () => void {
  beats.add(l);
  return () => beats.delete(l);
}

// ---------- how loud he is, for the living voice ----------

// The ElevenLabs reply is never routed through Web Audio: on iOS a media element source plays by
// the ringer switch and, once the microphone has been used, through the earpiece instead of the
// speaker. Instead the same audio is decoded on the side (an offline context makes no sound and
// needs no tap) into a loudness envelope, read against the element's own clock while it plays.
// The browser voice has no stream at all, so each word it says is a beat that decays naturally.

/** Envelope frames per second: one per screen frame. */
export const ENVELOPE_FPS = 60;

/**
 * Loudness of a voice as 0..1 per frame: the root mean square of each 1/fps slice, scaled so the
 * loud part of his speech (the 95th percentile) reaches 1, and gently compressed so quiet
 * syllables still show. Pure, so it is tested alone.
 */
export function envelopeOf(samples: ArrayLike<number>, sampleRate: number, fps = ENVELOPE_FPS): Float32Array {
  const size = Math.max(1, Math.round(sampleRate / fps));
  const frames = Math.ceil(samples.length / size);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const end = Math.min(samples.length, (f + 1) * size);
    for (let i = f * size; i < end; i++) {
      const s = samples[i] ?? 0;
      sum += s * s;
    }
    env[f] = Math.sqrt(sum / Math.max(1, end - f * size));
  }
  const sorted = Array.from(env).sort((a, b) => a - b);
  const peak = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
  if (peak <= 1e-4) return env.fill(0);
  for (let f = 0; f < frames; f++) env[f] = Math.min(1, ((env[f] ?? 0) / peak) ** 0.7);
  return env;
}

/** The envelope at a moment of playback, between frames. 0 outside it. */
export function levelAt(env: ArrayLike<number>, seconds: number, fps = ENVELOPE_FPS): number {
  if (!env.length || !(seconds >= 0)) return 0;
  const x = seconds * fps;
  const i = Math.floor(x);
  if (i >= env.length) return 0;
  const a = env[i] ?? 0;
  const b = env[i + 1] ?? a;
  return a + (b - a) * (x - i);
}

/**
 * The browser voice's loudness from its words: a swell on each word that dies away over about a
 * third of a second. Voices that report no words (some Chrome voices) get a soft syllable rhythm
 * instead, so he never looks frozen while he talks.
 */
export function beatLevel(sinceBeatMs: number, sinceStartMs: number): number {
  if (sinceBeatMs < 900) return 0.85 * Math.exp(-sinceBeatMs / 170);
  const t = sinceStartMs / 1000;
  return 0.2 + 0.35 * Math.abs(Math.sin(t * Math.PI * 4.3)) * (0.6 + 0.4 * Math.sin(t * Math.PI * 0.9));
}

/** Decodes a reply on the side into its envelope. Null where the browser cannot decode it. */
async function decodeEnvelope(blob: Blob): Promise<Float32Array | null> {
  try {
    const w = window as unknown as {
      OfflineAudioContext?: typeof OfflineAudioContext;
      webkitOfflineAudioContext?: typeof OfflineAudioContext;
    };
    const Offline = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
    if (!Offline) return null;
    const ctx = new Offline(1, 1, 44100);
    const data = await blob.arrayBuffer();
    // The callback form: older Safari has no promise from decodeAudioData.
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      p?.catch?.(reject);
    });
    return envelopeOf(buffer.getChannelData(0), buffer.sampleRate);
  } catch {
    return null;
  }
}

type Voice =
  | { kind: "audio"; player: HTMLAudioElement; env: Float32Array | null }
  | { kind: "browser"; started: number; beat: number };
let speaking: Voice | null = null;
const levels = new Set<(level: number) => void>();
let levelFrame = 0;

/**
 * How loud Michael is right now, 0..1, once per frame while he speaks (and one 0 when he stops).
 * Returns the unsubscribe.
 */
export function onSpeechLevel(l: (level: number) => void): () => void {
  levels.add(l);
  return () => levels.delete(l);
}

function emitLevel(level: number) {
  for (const l of levels) l(level);
}

function levelTick() {
  levelFrame = 0;
  const v = speaking;
  if (!v) return emitLevel(0);
  const now = performance.now();
  emitLevel(
    v.kind === "audio"
      ? v.env
        ? levelAt(v.env, v.player.currentTime)
        : 0
      : beatLevel(now - v.beat, now - v.started),
  );
  levelFrame = requestAnimationFrame(levelTick);
}

function setVoice(next: Voice | null) {
  speaking = next;
  if (next && !levelFrame && typeof requestAnimationFrame === "function") {
    levelFrame = requestAnimationFrame(levelTick);
  }
  if (!next) {
    if (levelFrame) cancelAnimationFrame(levelFrame);
    levelFrame = 0;
    emitLevel(0);
  }
}

// Settles the reply being spoken, so whoever waits on speakReply carries on when it is cut short.
let settle: (() => void) | null = null;
// Bumped by every stop: a reply still loading when it was stopped is never played.
let generation = 0;

export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (audio) audio.pause();
  if (speaking) setVoice(null);
  generation++;
  settle?.();
  settle = null;
}

/** Called once the voice is actually heard, with how long it lasts when known (ElevenLabs audio). */
export type SpeakOptions = { onStart?: (durationMs: number | null) => void };

function speakWithBrowser(text: string, gen: number, opts: SpeakOptions = {}): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  const synth = window.speechSynthesis;
  const pieces = speechChunks(text);
  if (!pieces.length) return Promise.resolve();
  // Every piece is queued at once; the promise settles when the last one has been said.
  const say = () =>
    new Promise<void>((resolve) => {
      if (gen !== generation) return resolve();
      const voice = pickVoice(synth.getVoices());
      pieces.forEach((piece, i) => {
        const u = new SpeechSynthesisUtterance(piece);
        if (voice) u.voice = voice;
        u.lang = voice?.lang ?? "en-GB";
        u.rate = 0.95;
        u.pitch = 0.8; // lower and calmer than the default
        if (i === 0) {
          const start = opts.onStart;
          u.onstart = () => {
            if (gen !== generation) return;
            const now = performance.now();
            setVoice({ kind: "browser", started: now, beat: now - 10_000 });
            start?.(null);
          };
        }
        u.onboundary = (e) => {
          if (e.name !== "word") return;
          if (speaking?.kind === "browser") speaking.beat = performance.now();
          for (const l of beats) l();
        };
        if (i === pieces.length - 1) {
          const done = () => {
            if (speaking?.kind === "browser") setVoice(null);
            resolve();
          };
          u.onend = done;
          u.onerror = done;
        }
        synth.speak(u);
      });
    });
  if (synth.getVoices().length > 0) return say();
  // Chrome fills the list a moment after load.
  return new Promise((resolve) => {
    const go = () => {
      synth.removeEventListener("voiceschanged", go);
      clearTimeout(timer);
      void say().then(resolve);
    };
    const timer = setTimeout(go, 800);
    synth.addEventListener("voiceschanged", go);
  });
}

async function speakWithElevenLabs(text: string, gen: number, opts: SpeakOptions = {}): Promise<boolean> {
  try {
    const res = await fetch("/chat/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 1000) }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (gen !== generation) return true;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    // Held in memory only for this one playback; never saved.
    audioUrl = URL.createObjectURL(blob);
    audio ??= new Audio();
    const player = audio;
    player.src = audioUrl;
    await player.play();
    const playing: Voice = { kind: "audio", player, env: null };
    if (gen === generation) setVoice(playing);
    void decodeEnvelope(blob).then((env) => {
      playing.env = env;
    });
    opts.onStart?.(Number.isFinite(player.duration) ? player.duration * 1000 : null);
    // Resolves when the reply has been said, or was cut short.
    await new Promise<void>((resolve) => {
      const done = () => {
        if (speaking === playing) setVoice(null);
        player.removeEventListener("ended", done);
        player.removeEventListener("pause", done);
        player.removeEventListener("error", done);
        resolve();
      };
      player.addEventListener("ended", done);
      player.addEventListener("pause", done);
      player.addEventListener("error", done);
    });
    return true;
  } catch {
    return false;
  }
}

/** Reads Michael's reply aloud: ElevenLabs when the API has it, else (or on any failure) the browser. */
export async function speakReply(text: string, elevenlabs: boolean, opts: SpeakOptions = {}): Promise<void> {
  if (typeof window === "undefined") return;
  const line = speakable(text);
  if (!line) return;
  // Settles when the reply has been said, or as soon as stopSpeaking cuts it short.
  const stopped = new Promise<"stopped">((resolve) => {
    settle = () => resolve("stopped");
  });
  const gen = generation;
  const said = (async () => {
    if (elevenlabs && (await speakWithElevenLabs(line, gen, opts))) return;
    await speakWithBrowser(line, gen, opts);
  })();
  // The wake word never listens while he talks: he must not wake himself.
  voicesOut++;
  setWakeHold("speaking", true);
  try {
    if ((await Promise.race([said, stopped])) === "stopped") return;
    settle = null;
  } finally {
    voicesOut--;
    if (voicesOut === 0) setWakeHold("speaking", false);
  }
}

// Replies being said right now (a new one can start before a cut one has settled).
let voicesOut = 0;
