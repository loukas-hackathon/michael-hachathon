import { getLiveStamp } from "@/lib/live";

// GET /live: the fingerprint components/live-refresh.tsx polls. Never cached; 204 when signed out
// or the API is unreachable, so the client simply keeps what is on screen.
export async function GET() {
  try {
    return Response.json({ stamp: await getLiveStamp() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
}
