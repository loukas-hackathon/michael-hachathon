import {
  VOICE_AUDIO_MAX_BYTES,
  VOICE_AUDIO_MIN_BYTES,
  VoiceAudioType,
  VoiceSpeakRequest,
  type VoiceStatus,
} from "@michael/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { currentAuthMethod, currentDemoVisitor, currentUserId } from "../context";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";
import { rateLimiter } from "../rate-limit";
import { transcribe, transcribeAvailable } from "../transcribe";

// Michael's voice: proxies ElevenLabs text to speech so the key never reaches the browser.
// Only text goes out and audio comes straight back; nothing is stored on our side.
const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// When the chosen voice is refused (401/402: a Voice Library voice on the free plan, or a key
// without access to it), Michael speaks with the built-in fallback voice for this long before the
// chosen one is tried again. Michael must never go silent because of a plan.
export const FALLBACK_FOR_MS = 60 * 60 * 1000;

type Fallback = { until: number; status: number };
let fallback: Fallback | null = null;

/** Tests only: forget the cached fallback decision. */
export function resetVoiceFallback(): void {
  fallback = null;
}

const usingFallback = (now = Date.now()) =>
  !!fallback && fallback.until > now && env.ELEVENLABS_FALLBACK_VOICE_ID !== env.ELEVENLABS_VOICE_ID;

function reasonFor(status: number): string {
  return status === 402 ? "paid plan required" : "chosen voice not allowed for this key";
}

export function voiceStatus(): VoiceStatus {
  const transcribe = transcribeAvailable();
  if (!env.ELEVENLABS_API_KEY)
    return { elevenlabs: false, voice: "device", reason: "no ElevenLabs key", transcribe };
  if (usingFallback() && fallback)
    return { elevenlabs: true, voice: "fallback", reason: reasonFor(fallback.status), transcribe };
  return { elevenlabs: true, voice: "chosen", reason: null, transcribe };
}

// Voice input: per caller (each demo visitor on their own), a sentence every few seconds is plenty.
export const transcribeLimit = { perMinute: rateLimiter(12, 60_000), perDay: rateLimiter(300, 86_400_000) };

/** "audio/webm;codecs=opus" becomes "audio/webm"; the aliases browsers use for the same formats. */
export function audioTypeOf(header: string | undefined): VoiceAudioType | null {
  const base = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const alias: Record<string, string> = {
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "video/mp4": "audio/mp4",
    "video/webm": "audio/webm",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/mp3": "audio/mpeg",
  };
  const parsed = VoiceAudioType.safeParse(alias[base] ?? base);
  return parsed.success ? parsed.data : null;
}

const TOO_LONG = "That recording is too long. Keep it under a minute.";

async function tts(voiceId: string, text: string, key: string): Promise<Response> {
  try {
    return await fetch(`${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: env.ELEVENLABS_MODEL,
        // Calm and steady: a little more stability than the default, no added style.
        voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0, speed: 0.95 },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error("voice: ElevenLabs unreachable:", err instanceof Error ? err.message : "unknown");
    throw new HttpError("upstream_error", "ElevenLabs could not be reached");
  }
}

// Only the status and ElevenLabs' own error text are logged: never the key or the user's words.
async function logFailure(res: Response, voice: string) {
  const detail = await res.text().catch(() => "");
  console.error(`voice: ElevenLabs ${res.status} for the ${voice} voice: ${detail.slice(0, 300)}`);
}

export const voice = new Hono()
  // Lets the app decide up front whether to ask for ElevenLabs or use the browser's voice.
  .get("/voice", (c) => c.json(voiceStatus()))
  .post(
    "/voice/transcribe",
    bodyLimit({
      maxSize: VOICE_AUDIO_MAX_BYTES,
      onError: () => {
        throw new HttpError("bad_request", TOO_LONG);
      },
    }),
    async (c) => {
      // The app's own voice input only: device keys and agents never send audio.
      const via = currentAuthMethod();
      if (via === "personal_token" || via === "mcp_oauth") {
        throw new HttpError("forbidden", "Voice input is for the Michael app");
      }
      const type = audioTypeOf(c.req.header("content-type"));
      if (!type) {
        throw new HttpError("bad_request", "Send the recording as audio (webm, mp4, mpeg, ogg, wav or aac)");
      }
      if (!transcribeAvailable()) {
        // Checked before reading the audio, so nothing is received that cannot be used.
        throw new HttpError("unavailable", "Voice input is not set up on the server");
      }
      const caller = currentDemoVisitor() ?? currentUserId();
      if (!transcribeLimit.perMinute.take(caller) || !transcribeLimit.perDay.take(caller)) {
        throw new HttpError("rate_limited", "That's a lot of talking. Give me a minute, then try again.");
      }

      const audio = await c.req.arrayBuffer();
      if (audio.byteLength > VOICE_AUDIO_MAX_BYTES) throw new HttpError("bad_request", TOO_LONG);
      if (audio.byteLength < VOICE_AUDIO_MIN_BYTES) {
        throw new HttpError("bad_request", "I didn't catch that. Hold the button and speak.");
      }
      // Transcribed and dropped: the buffer goes out of scope when this returns.
      return c.json(await transcribe(audio, type), 200, { "cache-control": "no-store" });
    },
  )
  .post("/voice/speak", async (c) => {
    const { text } = parse(VoiceSpeakRequest, await jsonBody(c));
    const key = env.ELEVENLABS_API_KEY;
    if (!key) {
      throw new HttpError("unavailable", "Voice is not set up: the API has no ELEVENLABS_API_KEY");
    }

    let res: Response;
    if (usingFallback()) {
      res = await tts(env.ELEVENLABS_FALLBACK_VOICE_ID, text, key);
    } else {
      res = await tts(env.ELEVENLABS_VOICE_ID, text, key);
      const refused = res.status === 401 || res.status === 402;
      if (refused && env.ELEVENLABS_FALLBACK_VOICE_ID !== env.ELEVENLABS_VOICE_ID) {
        await logFailure(res, "chosen");
        fallback = { until: Date.now() + FALLBACK_FOR_MS, status: res.status };
        console.error(`voice: using the fallback voice for an hour (${reasonFor(res.status)})`);
        res = await tts(env.ELEVENLABS_FALLBACK_VOICE_ID, text, key);
      }
    }
    if (!res.ok || !res.body) {
      // Both refused, or 429 quota used up: the app falls back to the browser's voice.
      await logFailure(res, usingFallback() ? "fallback" : "chosen");
      throw new HttpError("upstream_error", `ElevenLabs answered ${res.status}`);
    }

    return new Response(res.body, {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  });
