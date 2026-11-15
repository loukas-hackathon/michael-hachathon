import { MomentKind } from "@michael/shared";
import { getMoment } from "@/lib/moments";

// GET /moment/morning | /moment/evening: the moment's headline once the model has written it
// (#378). Today renders the template at once and asks here for the model's line, so the screen
// never waits for it. A route handler, not a server action: actions run one at a time, and a
// slow model call must never hold up a tap on Done. 204 when there is nothing better to show.
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const kind = MomentKind.safeParse((await params).kind);
  const headers = { "cache-control": "no-store" };
  if (!kind.success) return new Response(null, { status: 404, headers });
  try {
    const m = await getMoment(kind.data, false);
    return Response.json({ headline: m.headline, phrased_by: m.phrased_by }, { headers });
  } catch {
    return new Response(null, { status: 204, headers });
  }
}
