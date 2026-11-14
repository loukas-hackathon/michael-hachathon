import { getStageFeed } from "@/lib/stage";

// GET /stage/feed: the stage view's live part, polled every 3 seconds. Never cached.
export async function GET() {
  return Response.json(await getStageFeed(), { headers: { "cache-control": "no-store" } });
}
