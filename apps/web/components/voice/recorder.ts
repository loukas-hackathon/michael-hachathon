// Voice input by recording (#313): where the browser cannot recognise speech itself (an iPhone home
// screen app refuses to, Firefox has none) or does it badly (iPhone Safari cuts off early), the
// app records the sentence with MediaRecorder and the API transcribes it with ElevenLabs Scribe.
// The recording lives in memory only until it is sent; the API drops it once it has the text.

import { VOICE_AUDIO_MAX_SECONDS } from "@michael/shared/voice-limits";
import { isIos, readRefused, recognitionCtor, subscribeRefused } from "./speech";

// ---------- which way to listen ----------

export type InputMode = "recognition" | "recorder" | "none";

/**
 * How push to talk and the conversation listen on this device. The server's recorder path wins
 * where the browser's recogniser is missing, refused or weak (iOS); the recogniser stays where it
 * works (desktop and Android Chrome, live words as you speak) and as the fallback when the server
 * cannot transcribe.
 */
export function chooseInput(o: {
  recognition: boolean;
  refused: boolean;
  recorder: boolean;
  server: ServerStt;
  ios: boolean;
}): InputMode {
  const recogniser = o.recognition && !o.refused;
  const server = o.recorder && o.server === "yes";
  if (server && (!recogniser || o.ios)) return "recorder";
  if (recogniser) return "recognition";
  return "none";
}

/** MediaRecorder and a microphone API exist (iOS 14.5 and later, every current desktop browser). */
export function recorderSupported(): boolean {
  if (typeof window === "undefined") return false;
  return typeof window.MediaRecorder === "function" && !!navigator.mediaDevices?.getUserMedia;
}

// ---------- can the server transcribe ----------

export type ServerStt = "unknown" | "yes" | "no";
let server: ServerStt = "unknown";
let asked = false;
const serverListeners = new Set<() => void>();

function setServer(next: ServerStt) {
  server = next;
  for (const l of serverListeners) l();
}

export const readServerStt = (): ServerStt => server;

export function subscribeServerStt(l: () => void): () => void {
  serverListeners.add(l);
  return () => serverListeners.delete(l);
}

/** Asks the API once per visit whether it can transcribe (it needs the ElevenLabs key). */
export function checkServerStt(): void {
  if (asked || typeof window === "undefined") return;
  asked = true;
  fetch("/chat/transcribe", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((b: { available?: boolean } | null) => setServer(b?.available === true ? "yes" : "no"))
    .catch(() => setServer("no"));
}

/** Transcription stopped working (no access on the key): back to the recogniser for this visit. */
export function markServerSttFailed(): void {
  setServer("no");
}

/** How this device listens right now: the browser's recogniser, a recording for the API, or not. */
export function currentInputMode(): InputMode {
  return chooseInput({
    recognition: recognitionCtor() !== null,
    refused: readRefused(),
    recorder: recorderSupported(),
    server: readServerStt(),
    ios: isIos(),
  });
}

export function subscribeInputMode(l: () => void): () => void {
  const a = subscribeRefused(l);
  const b = subscribeServerStt(l);
  return () => {
    a();
    b();
  };
}

/** Asks the API whether it can transcribe, where that would help: no recogniser, refused, or iOS. */
export function checkRecorderPath(): void {
  if (recorderSupported() && (recognitionCtor() === null || readRefused() || isIos())) checkServerStt();
}

// ---------- recording ----------

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"];

/** The first format this browser records (Chrome and Firefox: webm/opus; Safari: mp4/aac). */
export function pickMimeType(isTypeSupported: (type: string) => boolean): string | null {
  for (const t of TYPES) {
    try {
      if (isTypeSupported(t)) return t;
    } catch {
      // Older Safari throws for types it does not know.
    }
  }
  return null;
}

/** The Content-Type to send: no codec parameters, and "video/webm" from some browsers is audio. */
export function uploadType(mimeType: string): string {
  const base = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
  if (!base) return "audio/webm";
  return base.startsWith("video/") ? base.replace("video/", "audio/") : base;
}

/** Loudness of one frame of samples (-1..1) as a 0..1 level: the root mean square. */
export function levelOf(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}

export const SPEECH_LEVEL = 0.035;
/** Louder than the room for this long counts as the user speaking. */
export const SPEECH_MS = 150;
/** Quiet this long after speaking ends the turn in the conversation (#313: 1.2 s). */
export const PAUSE_MS = 1200;

/**
 * Turn taking from the microphone level: "speech" once the user has spoken for a moment, then
 * "pause" once they have been quiet for `pauseMs`. Each fires once. Pure, so it is tested alone.
 */
export function silenceDetector(opts: { threshold?: number; speechMs?: number; pauseMs?: number } = {}) {
  const threshold = opts.threshold ?? SPEECH_LEVEL;
  const speechMs = opts.speechMs ?? SPEECH_MS;
  const pauseMs = opts.pauseMs ?? PAUSE_MS;
  let loudSince: number | null = null;
  let lastLoud = 0;
  let spoke = false;
  let paused = false;
  return {
    get spoke() {
      return spoke;
    },
    feed(level: number, now: number): "speech" | "pause" | null {
      if (level >= threshold) {
        lastLoud = now;
        loudSince ??= now;
        if (!spoke && now - loudSince >= speechMs) {
          spoke = true;
          return "speech";
        }
        return null;
      }
      loudSince = null;
      if (spoke && !paused && now - lastLoud >= pauseMs) {
        paused = true;
        return "pause";
      }
      return null;
    },
  };
}

/** Why the microphone could not start, in the recogniser's own codes so the copy is shared. */
export class MicError extends Error {
  constructor(public code: "not-allowed" | "audio-capture" | "unknown") {
    super(code);
  }
}

let mic: MediaStream | null = null;
let ctx: AudioContext | null = null;

/**
 * Call inside a tap: an AudioContext made or resumed in a gesture is allowed to run on iOS, which
 * the level meter and the conversation's pause detection need. Harmless elsewhere.
 */
export function primeRecorder(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  } catch {
    // No Web Audio: recording still works, only without the meter.
  }
}

async function getMic(): Promise<MediaStream> {
  if (mic?.getAudioTracks().some((t) => t.readyState === "live")) return mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return mic;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw new MicError("not-allowed");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicError("audio-capture");
    throw new MicError("unknown");
  }
}

/** Turns the microphone off (the browser's mic indicator goes away). */
export function releaseMic(): void {
  for (const t of mic?.getTracks() ?? []) t.stop();
  mic = null;
}

export type Recording = {
  /** False when the level cannot be read (no Web Audio): no meter and no pause detection. */
  metered: boolean;
  /** Stops and hands back the sentence, or null when nothing usable was recorded. */
  stop(): Promise<Blob | null>;
  /** Stops and throws the recording away. */
  cancel(): void;
};

export type RecordOptions = {
  /** 0..1, about twenty times a second, for the meter. */
  onLevel?: (level: number) => void;
  onSpeech?: () => void;
  /** The user stopped talking (PAUSE_MS of quiet after speech). */
  onPause?: () => void;
  /** The one minute limit was reached; call stop(). */
  onLimit?: () => void;
};

/** Shorter than this is a tap, not a sentence. */
export const MIN_RECORDING_MS = 400;

/** Starts recording from the microphone. Throws MicError when it cannot. */
export async function startRecording(opts: RecordOptions = {}): Promise<Recording> {
  const stream = await getMic();
  const type = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
  const rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const started = Date.now();

  // Level and pauses from the same stream. Missing Web Audio only loses the meter.
  let meter: ReturnType<typeof setInterval> | undefined;
  let source: MediaStreamAudioSourceNode | null = null;
  try {
    primeRecorder();
    if (ctx) {
      source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const frame = new Float32Array(analyser.fftSize);
      const turns = silenceDetector();
      meter = setInterval(() => {
        analyser.getFloatTimeDomainData(frame);
        const level = levelOf(frame);
        opts.onLevel?.(level);
        const turn = turns.feed(level, Date.now());
        if (turn === "speech") opts.onSpeech?.();
        if (turn === "pause") opts.onPause?.();
      }, 50);
    }
  } catch {
    // The meter is a nicety.
  }
  const limit = setTimeout(() => opts.onLimit?.(), VOICE_AUDIO_MAX_SECONDS * 1000 - 500);

  const finish = () => {
    clearInterval(meter);
    clearTimeout(limit);
    try {
      source?.disconnect();
    } catch {
      // Already gone.
    }
  };

  // Chunks every 250 ms: some Safari versions lose the data of a recorder started without them.
  rec.start(250);

  return {
    metered: meter !== undefined,
    stop() {
      finish();
      if (rec.state === "inactive") return Promise.resolve(null);
      return new Promise((resolve) => {
        rec.onstop = () => {
          const long = Date.now() - started >= MIN_RECORDING_MS;
          const blob = new Blob(chunks, { type: uploadType(rec.mimeType || type || "audio/webm") });
          chunks.length = 0;
          resolve(long && blob.size > 0 ? blob : null);
        };
        rec.stop();
      });
    },
    cancel() {
      finish();
      rec.ondataavailable = null;
      rec.onstop = null;
      chunks.length = 0;
      if (rec.state !== "inactive") rec.stop();
    },
  };
}

// ---------- transcribing ----------

export type Transcribed = { ok: true; text: string } | { ok: false; code: string };

/** Sends the recording to the API (through /chat/transcribe) and gives back the words. */
export async function transcribeRecording(blob: Blob): Promise<Transcribed> {
  try {
    const res = await fetch("/chat/transcribe", {
      method: "POST",
      headers: { "content-type": blob.type || "audio/webm" },
      body: blob,
    });
    const body = (await res.json().catch(() => null)) as {
      text?: unknown;
      error?: { code?: unknown };
    } | null;
    if (res.ok && typeof body?.text === "string") return { ok: true, text: body.text.trim() };
    const code = typeof body?.error?.code === "string" ? body.error.code : "upstream_error";
    if (code === "unavailable") markServerSttFailed();
    return { ok: false, code };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Michael's line for each way transcription can fail. */
export function transcribeErrorCopy(code: string): string {
  if (code === "rate_limited") return "That's a lot of talking. Give me a minute.";
  if (code === "bad_request") return "I didn't catch that. Hold the button and speak.";
  if (code === "network") return "I lost the line. Try again.";
  if (code === "unavailable") return "I can't listen right now. Type instead.";
  if (code === "unauthorized") return "Your session ran out. Sign in again.";
  return "I couldn't make that out. Try again.";
}

export const NOTHING_HEARD_COPY = "I didn't catch that. Hold the button and speak.";

/** A quick tap on the hold to dictate mic: say how it works, and where the conversation is. */
export const TAPPED_COPY = "Hold the mic while you speak, or tap Talk for a conversation.";
/** Shorter than this, a press on the mic is a tap. */
export const TAP_MS = 350;
