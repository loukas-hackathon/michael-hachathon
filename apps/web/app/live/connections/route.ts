import { getConnections } from "@/lib/connections-status";
import type { LiveConnection } from "@/lib/live-connections";

// GET /live/connections: every connection's state, read fresh from the API each time (no memo, no
// cache). components/you/connections-live.tsx polls it while a connection is on its way, so a
// Telegram /start or the Mac's first event flips the row without a reload (#466). 204 when the
// status cannot be read, so the client keeps what is on screen.
export async function GET() {
  try {
    const view = await getConnections();
    const rows: LiveConnection[] = view.rows.map((r) => ({
      id: r.id,
      state: r.state,
      fresh: r.fresh ?? null,
    }));
    return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
  } catch {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
}
