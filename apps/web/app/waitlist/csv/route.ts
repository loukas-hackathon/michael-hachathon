import { getWaitlistAdmin } from "@/lib/waitlist";
import { waitlistCsv } from "@/lib/waitlist-csv";

// GET /waitlist/csv: the whole list, newest first, for admins only. Everyone else: a plain 404.
export async function GET() {
  const data = await getWaitlistAdmin();
  if (!data) return new Response("Not found", { status: 404 });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(waitlistCsv(data.entries), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="michael-waitlist-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
