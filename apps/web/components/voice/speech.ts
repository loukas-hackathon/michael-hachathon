// Browser speech in and out for push to talk. Recognition runs in the browser (Web Speech API);
// Michael only ever receives text. No audio is recorded or kept by us.

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

/** All text heard so far, final and interim, in order. */
export function transcriptOf(e: RecognitionEvent): string {
  let text = "";
  for (let i = 0; i < e.results.length; i++) text += e.results[i]?.[0]?.transcript ?? "";
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

// ---------- speech out ----------

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

/** Call inside the press: unlocks audio and speech on iOS, and silences Michael mid sentence. */
export function primeSpeech(): void {
  stopSpeaking();
  try {
    audio ??= new Audio();
    silent ??= silentWav();
    audio.src = silent;
    void audio.play().catch(() => {});
  } catch {
    // No audio element (very old browser): the browser voice still works.
  }
  if ("speechSynthesis" in window) {
    // Safari loads voices lazily; asking once early means they are ready when the reply lands.
    window.speechSynthesis.getVoices();
  }
}

export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (audio) audio.pause();
}

function speakWithBrowser(text: string): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  const synth = window.speechSynthesis;
  const say = () =>
    new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(synth.getVoices());
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? "en-GB";
      u.rate = 0.95;
      u.pitch = 0.8; // lower and calmer than the default
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
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

async function speakWithElevenLabs(text: string): Promise<boolean> {
  try {
    const res = await fetch("/chat/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 1000) }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    // Held in memory only for this one playback; never saved.
    audioUrl = URL.createObjectURL(blob);
    audio ??= new Audio();
    audio.src = audioUrl;
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

/** Reads Michael's reply aloud: ElevenLabs when the API has it, else (or on any failure) the browser. */
export async function speakReply(text: string, elevenlabs: boolean): Promise<void> {
  if (typeof window === "undefined" || !text.trim()) return;
  if (elevenlabs && (await speakWithElevenLabs(text))) return;
  await speakWithBrowser(text);
}
