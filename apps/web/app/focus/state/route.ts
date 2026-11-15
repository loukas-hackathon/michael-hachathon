import { getFocusActive } from "@/lib/focus";

// GET /focus/state: the running session and the one that just stopped (#534). A plain route, not a
// server action, because Next runs server actions one at a time: when an End early answer is
// stuck, a second action would queue behind it and the screen would wait forever. The session
// screen asks here instead, with its own timeout.
export async function GET() {
  const state = await getFocusActive();
  return Response.json(state, { headers: { "cache-control": "no-store" } });
}
