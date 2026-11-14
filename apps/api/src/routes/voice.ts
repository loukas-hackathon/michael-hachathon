import { VoiceSpeakRequest } from "@michael/shared";
import { Hono } from "hono";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";

// Michael's voice: proxies ElevenLabs text to speech so the key never reaches the browser.
// Only text goes out and audio comes straight back; nothing is stored on our side.
const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export const voice = new Hono()
  // Lets the app decide up front whether to ask for ElevenLabs or use the browser's voice.
  .get("/voice", (c) => c.json({ elevenlabs: !!env.ELEVENLABS_API_KEY }))
  .post("/voice/speak", async (c) => {
    const { text } = parse(VoiceSpeakRequest, await jsonBody(c));
    if (!env.ELEVENLABS_API_KEY) {
      throw new HttpError("unavailable", "Voice is not set up: the API has no ELEVENLABS_API_KEY");
    }

    let res: Response;
    try {
      res = await fetch(
        `${ELEVENLABS_URL}/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": env.ELEVENLABS_API_KEY,
            "content-type": "application/json",
            accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: env.ELEVENLABS_MODEL,
            // Calm and steady: a little more stability than the default, no added style.
            voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0, speed: 0.95 },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (err) {
      console.error("voice: ElevenLabs unreachable:", err);
      throw new HttpError("upstream_error", "ElevenLabs could not be reached");
    }
    if (!res.ok || !res.body) {
      // 401 bad key, 402/429 free quota used up: the app falls back to the browser's voice.
      const detail = await res.text().catch(() => "");
      console.error(`voice: ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
      throw new HttpError("upstream_error", `ElevenLabs answered ${res.status}`);
    }

    return new Response(res.body, {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  });
