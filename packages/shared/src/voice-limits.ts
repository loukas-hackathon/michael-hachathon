// Voice in (POST /v1/voice/transcribe) limits, zod free so the recorder on the client can read them.

export const VOICE_AUDIO_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/aac",
] as const;
// About a minute of speech from any browser (iPhone records AAC at up to 128 kbps); also under
// Vercel's 4.5 MB request limit, which the web app's proxy sits behind.
export const VOICE_AUDIO_MAX_BYTES = 4 * 1024 * 1024;
export const VOICE_AUDIO_MAX_SECONDS = 60;
// Shorter than this is a tap, not speech.
export const VOICE_AUDIO_MIN_BYTES = 1000;
