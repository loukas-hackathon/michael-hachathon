import { VOICE_AUDIO_MAX_BYTES } from "@michael/shared";
import { getTranscribeEnabled, transcribe } from "@/lib/api";

// Voice input when the browser cannot recognise speech itself (an iPhone home screen app, mostly):
// the recording passes through to the API, which transcribes it and drops it. Nothing is stored
// or logged here. The token stays on the server.

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Whether recording and transcribing is possible at all, asked once when the mic needs it. */
export async function GET() {
  return json({ available: await getTranscribeEnabled() });
}

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("audio/")) {
    return json({ error: { code: "bad_request", message: "Send audio" } }, 400);
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > VOICE_AUDIO_MAX_BYTES) {
    return json({ error: { code: "bad_request", message: "Too long" } }, 400);
  }
  const audio = await request.arrayBuffer();
  if (audio.byteLength > VOICE_AUDIO_MAX_BYTES) {
    return json({ error: { code: "bad_request", message: "Too long" } }, 400);
  }
  const res = await transcribe(audio, type);
  if (!res) return json({ error: { code: "network", message: "Could not reach the API" } }, 502);
  return json(await res.json().catch(() => null), res.status);
}
