import { Source, type Traction } from "@michael/shared";
import { agentsStore } from "../agents-store";
import { runAsUser } from "../context";
import { env } from "../env";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { loadWeek } from "../routes/score";
import { type AccountRow, store } from "../store";
import { computeTraction, sumGoalWeek, weekStarts } from "./compute";

// GET /v1/admin/traction: reads what the numbers need across real users, in batches, and hands it
// to the pure maths in compute.ts. Cached for a few minutes: investors refresh, the database
// should not notice.

/**
 * Accounts that are never counted. The demo account (DEMO_USER_ID) is the stage week: the API key,
 * every demo visitor and the judges' login (a private demo visitor, apps/web/lib/judges.ts) all act
 * as it. Any address at michael.app is ours (demo@, judges@, team@), never a customer's.
 */
export const isExcludedAccount = (a: AccountRow): boolean =>
  a.id === env.DEMO_USER_ID || (a.email ?? "").trim().toLowerCase().endsWith("@michael.app");

/** Sources that mean the user connected something real: everything but typed, agent and derived data. */
export const REAL_SOURCES: Source[] = Source.options.filter(
  (s) => s !== "manual" && s !== "agent" && s !== "maps",
);

/** At most this many users are scored for goal time (two score reads each), the most active first. */
export const MAX_SCORED = 200;
const SCORE_PARALLEL = 4;
const CACHE_MS = 5 * 60_000;

let cached: { at: number; value: Traction } | null = null;
let running: Promise<Traction> | null = null;

/** Tests: forget the cached numbers. */
export const clearTractionCache = () => {
  cached = null;
  running = null;
};

export async function getTraction(now = Date.now()): Promise<Traction> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  if (!running) {
    running = buildTraction(now)
      .then((value) => {
        cached = { at: now, value };
        return value;
      })
      .finally(() => {
        running = null;
      });
  }
  return running;
}

async function buildTraction(now: number): Promise<Traction> {
  const timezone = DEFAULT_TIMEZONE;
  const zone = new Zone(timezone);
  const all = await store.listAllAccounts();
  const accounts = all.filter((a) => !isExcludedAccount(a));
  const ids = accounts.map((a) => a.id);
  const mondays = weekStarts(now, timezone);
  const since = new Date(zone.startOfDay(mondays[0] as string)).toISOString();
  const [facts, queries] = await Promise.all([
    store.tractionFacts(ids, { since, timezone, sources: REAL_SOURCES }),
    agentsStore.queryCountsFor(ids),
  ]);

  // Goal time: the existing score (routes/score.ts loadWeek), this week and last, for users active
  // in either week. The most active first when there are more than MAX_SCORED.
  const thisMonday = mondays[mondays.length - 1] as string;
  const lastMonday = mondays[mondays.length - 2] as string;
  const lastSunday = zone.nextDay(thisMonday, -1);
  const active = facts
    .map((f) => ({ id: f.user_id, days: f.active_days.filter((d) => d >= lastMonday).length }))
    .filter((x) => x.days > 0)
    .sort((a, b) => b.days - a.days);
  const scored = active.slice(0, MAX_SCORED).map((x) => x.id);
  const today = zone.dayOf(now);
  const thisWeek: Parameters<typeof sumGoalWeek>[1] = [];
  const lastWeek: Parameters<typeof sumGoalWeek>[1] = [];
  for (let i = 0; i < scored.length; i += SCORE_PARALLEL) {
    await Promise.all(
      scored.slice(i, i + SCORE_PARALLEL).map((userId) =>
        runAsUser(userId, async () => {
          try {
            const [a, b] = await Promise.all([loadWeek({ date: today }), loadWeek({ date: lastSunday })]);
            thisWeek.push(a.score);
            lastWeek.push(b.score);
          } catch (err) {
            // One user's score failing never takes the numbers down; they are left out.
            console.error(`[traction] score skipped: ${(err as Error).message}`);
          }
        }),
      ),
    );
  }

  return computeTraction({
    now,
    timezone,
    accounts,
    excluded: all.length - accounts.length,
    facts,
    connectorQueries: Object.values(queries).reduce((s, n) => s + n, 0),
    goalTime: {
      this_week: sumGoalWeek(thisMonday, thisWeek),
      last_week: sumGoalWeek(lastMonday, lastWeek),
      users_scored: scored.length,
      capped: active.length > scored.length,
    },
  });
}
