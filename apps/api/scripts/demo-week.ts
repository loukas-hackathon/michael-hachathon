// (Re)seeds the demo account (demo@michael.app) with the generated demo week (src/demo/week.ts):
// the seven days ending now, the calendar to Sunday, and the demo goals reset to the Build Hub plan.
// Idempotent: only rows whose external_id starts with "demo:" are added or removed, and only for
// the demo user; nothing else in the database is touched. The running API also refreshes the week
// by itself (every 5 minutes on demo requests), so this is for a clean reset or a first fill.
//
// Usage: pnpm --filter @michael/api seed:demo          (reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
//        pnpm --filter @michael/api seed:demo --dry    (no database: prints what would be seeded)
import { runAsUser } from "../src/context";
import { seedDemoWeek } from "../src/demo/sync";
import { localDate } from "../src/demo/time";
import { buildDemoWeek } from "../src/demo/week";
import { env } from "../src/env";
import { SupabaseStore } from "../src/supabase-store";

if (process.argv.includes("--dry")) {
  const week = buildDemoWeek();
  const perDay = new Map<string, Record<string, number>>();
  for (const e of week.events) {
    const day = localDate(Date.parse(e.start_at));
    const counts = perDay.get(day) ?? {};
    counts[`${e.source} ${e.type}`] = (counts[`${e.source} ${e.type}`] ?? 0) + 1;
    perDay.set(day, counts);
  }
  console.log(`${week.events.length} events over ${week.days[0]} to ${week.days.at(-1)}`);
  for (const [day, counts] of perDay) console.log(day, counts);
  process.exit(0);
}

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or pass --dry). Nothing seeded.");
  process.exit(1);
}

const store = new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const result = await runAsUser(env.DEMO_USER_ID, () => seedDemoWeek(store, { overwriteGoals: true }));
console.log(`Demo week for ${env.DEMO_USER_ID}, ${result.days[0]} to ${result.days.at(-1)}:`);
console.log(
  `events: ${result.events.inserted} inserted, ${result.events.removed} removed, ${result.events.kept} kept; goals: ${result.goals_written} written`,
);
