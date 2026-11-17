import { getVoiceEnabled } from "@/lib/api";

// Whether Michael speaks with his own voice (ElevenLabs) here: the island ("Yo Michael") asks once
// before his first answer, so a wake on any screen sounds like him. False on any failure: the
// browser's voice is fine.
export async function GET() {
  const elevenlabs = await getVoiceEnabled().catch(() => false);
  return Response.json({ elevenlabs }, { headers: { "cache-control": "private, max-age=300" } });
}
