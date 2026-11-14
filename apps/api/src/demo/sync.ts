import type { DemoSeedResult, Source } from "@michael/shared";
import { currentUserId } from "../context";
import { env } from "../env";
import { HttpError } from "../http";
import type { Store } from "../store";
import { buildDemoWeek, DEMO_PREFIX, demoGoals } from "./week";

/**
 * Brings the demo account up to now: the generated week's events (only rows whose external_id
 * starts with "demo:"; anything else in the account is left alone) and the demo goals.
 * `overwriteGoals` resets the goals to the Build Hub plan; otherwise only missing ones are added,
 * so edits made during a demo (by the user or Claude) survive the automatic refresh.
 *
 * Off the record, nothing changes. Refuses anyone but the demo account.
 */
export async function seedDemoWeek(
  store: Store,
  opts: { overwriteGoals: boolean; now?: Date },
): Promise<DemoSeedResult> {
  if (currentUserId() !== env.DEMO_USER_ID)
    throw new HttpError("forbidden", "Only the demo account has a demo week");
  const week = buildDemoWeek(opts.now ?? new Date());

  // Off the record stops the demo week too (it is the switch people try on stage). Per source
  // switches are not applied: on the demo account they keep real collectors out (#114), and
  // everything seeded here is synthetic.
  const rules = await store.privacyRules();
  const sources: Source[] = rules.offTheRecord ? [] : [...new Set(week.events.map((e) => e.source))];

  const events = await store.syncSeededEvents(DEMO_PREFIX, sources, week.events);
  const goals = await store.seedGoals(demoGoals, { overwrite: opts.overwriteGoals });
  return { days: week.days, events, goals_written: goals };
}

const REFRESH_MS = 5 * 60_000;
let lastRefresh = 0;
let goalsReset = false;
let inflight: Promise<void> | null = null;

/**
 * Called on every demo account request: refreshes the demo week at most every five minutes, so
 * "today" always has data up to about now. Errors are logged and never fail the request.
 */
export async function keepDemoWeekFresh(store: Store): Promise<void> {
  if (env.DEMO_WEEK !== "on" || currentUserId() !== env.DEMO_USER_ID) return;
  if (inflight) return inflight;
  if (Date.now() - lastRefresh < REFRESH_MS) return;
  // The first refresh after a deploy resets the goals to the plan; later ones keep demo edits.
  inflight = seedDemoWeek(store, { overwriteGoals: !goalsReset })
    .then(() => {
      goalsReset = true;
      lastRefresh = Date.now();
    })
    .catch((err) => {
      // Try again on a later request, not on every one.
      lastRefresh = Date.now() - REFRESH_MS + 60_000;
      console.error("Demo week refresh failed", err);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
