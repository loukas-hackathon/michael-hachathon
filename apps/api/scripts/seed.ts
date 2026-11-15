// Puts the demo account's "Do it, then Undo" card back: the outreach focus block suggestion
// (src/demo/retired.ts, demoWeekRecommendations), reset to proposed on the next free slot, so
// "Do it" has a block ahead to create. Run it again before a demo if the card was used.
//
// It writes nothing else. It used to write the sample day's goals, the sample brief ("gemini
// (mock)") and its suggestions into the demo account; those made the stage look generic (#330) and
// the demo seed now removes them (src/demo/sync.ts). The demo account's week, goals and follow up
// drafts come from scripts/demo-week.ts (seed:demo) and from the running API.
// Usage: pnpm --filter @michael/api seed   (reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from "@supabase/supabase-js";
import { demoWeekRecommendations } from "../src/demo/retired";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Nothing seeded.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
// Seeded rows belong to the demo account (demo@michael.app).
const userId = process.env.DEMO_USER_ID ?? "2ee12960-e594-456d-85cb-a672d0ff3ac3";

const demo = demoWeekRecommendations();
// A reset demo block may have been carried out before: drop the timeline copy Michael made then
// (external_id michael:<id>), so carrying it out again starts clean.
const { error: dropError } = await db
  .from("events")
  .delete()
  .eq("user_id", userId)
  .eq("source", "agent")
  .in(
    "external_id",
    demo.map((r) => `michael:${r.id}`),
  );
if (dropError) throw new Error(`events: ${dropError.message}`);
const { data, error } = await db
  .from("recommendations")
  .upsert(
    demo.map((r) => ({ ...r, user_id: userId })),
    { onConflict: "id" },
  )
  .select("id");
if (error) throw new Error(`recommendations: ${error.message}`);
console.log(`recommendations: ${data?.length ?? 0} reset to now`);
