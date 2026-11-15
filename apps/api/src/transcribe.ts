import type { VoiceAudioType, VoiceTranscript } from "@michael/shared";
import { z } from "zod";
import { env } from "./env";
import { HttpError } from "./http";

// Speech to text with ElevenLabs Scribe (POST /v1/speech-to-text, the same key as Michael's voice;
// the key needs the Speech to Text permission). The recording is passed straight through from
// memory and dropped when the call returns: never written anywhere, never logged.
const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

// A key without the Speech to Text permission answers 401/403. Remembered for this long, so
// GET /v1/voice says transcription is off and the app uses the browser's recogniser instead.
export const REFUSED_FOR_MS = 10 * 60 * 1000;
let refusedUntil = 0;

/** Tests only. */
export function resetTranscribeRefusal(): void {
  refusedUntil = 0;
}

export const transcribeAvailable = (now = Date.now()) => !!env.ELEVENLABS_API_KEY && refusedUntil <= now;

const ScribeResponse = z.object({
  text: z.string(),
  language_code: z.string().nullish(),
});

const EXTENSION: Record<VoiceAudioType, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/aac": "aac",
};

/** Only what the person said: Scribe marks noises and silence in brackets, e.g. "(silence)". */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\((?:[^()]*)\)|\[(?:[^[\]]*)\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function transcribe(audio: ArrayBuffer, type: VoiceAudioType): Promise<VoiceTranscript> {
  const key = env.ELEVENLABS_API_KEY;
  if (!key)
    throw new HttpError("unavailable", "Voice input is not set up: the API has no ELEVENLABS_API_KEY");
  if (!transcribeAvailable()) {
    throw new HttpError("unavailable", "Voice input is off: the ElevenLabs key has no Speech to Text access");
  }

  const form = new FormData();
  form.set("model_id", env.ELEVENLABS_STT_MODEL);
  // No language_code: Scribe detects it (English and Greek both work).
  form.set("tag_audio_events", "false");
  form.set("file", new Blob([audio], { type }), `speech.${EXTENSION[type]}`);

  let res: Response;
  try {
    res = await fetch(STT_URL, {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.error("transcribe: ElevenLabs unreachable:", err instanceof Error ? err.name : "unknown");
    throw new HttpError("upstream_error", "ElevenLabs could not be reached");
  }

  if (!res.ok) {
    // ElevenLabs' own error text only (it never echoes the audio); never the key.
    const detail = await res.text().catch(() => "");
    console.error(`transcribe: ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
    if (res.status === 401 || res.status === 403) {
      refusedUntil = Date.now() + REFUSED_FOR_MS;
      throw new HttpError(
        "unavailable",
        "Voice input is off: the ElevenLabs key has no Speech to Text access",
      );
    }
    if (res.status === 400 || res.status === 422) {
      throw new HttpError("bad_request", "I couldn't read that recording");
    }
    throw new HttpError("upstream_error", `ElevenLabs answered ${res.status}`);
  }

  const body = ScribeResponse.safeParse(await res.json().catch(() => null));
  if (!body.success) throw new HttpError("upstream_error", "ElevenLabs sent an answer I could not read");
  return { text: cleanTranscript(body.data.text), language: body.data.language_code ?? null };
}
