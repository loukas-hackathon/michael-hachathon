// Seeds Supabase with the demo goals, one analysis run and its recommendations from
// @michael/shared. Idempotent: rows keep their fixed ids and existing ids are skipped.
// Events are not seeded here; the demo account's week comes from scripts/demo-week.ts (seed:demo).
// Usage: pnpm --filter @michael/api seed   (reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
import { mockAnalysisRun, mockGoals, mockRecommendations } from "@michael/shared";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Nothing seeded.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
// Seeded rows belong to the demo account (demo@michael.app).
const userId = process.env.DEMO_USER_ID ?? "2ee12960-e594-456d-85cb-a672d0ff3ac3";
const owned = <T extends object>(rows: T[]) => rows.map((r) => ({ ...r, user_id: userId }));

async function seed(table: string, rows: Record<string, unknown>[]) {
  const { data, error } = await db
    .from(table)
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`${table}: ${data?.length ?? 0} new, ${rows.length - (data?.length ?? 0)} already there`);
}

await seed("goals", owned(mockGoals));
await seed("analysis_runs", owned([mockAnalysisRun]));
await seed("recommendations", owned(mockRecommendations));
