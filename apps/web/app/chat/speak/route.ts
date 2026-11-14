import { VoiceSpeakRequest } from "@michael/shared";
import { speak } from "@/lib/api";

// The browser asks here for Michael's spoken reply; the API key and the user's token stay on the
// server. The mp3 passes straight through and nothing is stored. Any failure is a 503, and the
// browser then speaks with its own voice.
export async function POST(request: Request) {
  const body = VoiceSpeakRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const res = await speak(body.data.text);
  if (!res?.body) return new Response(null, { status: 503 });
  return new Response(res.body, {
    headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
  });
}
