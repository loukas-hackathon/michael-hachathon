import type { DemoSeedResult, Source } from "@michael/shared";
import { currentUserId } from "../context";
import { env } from "../env";
import { HttpError } from "../http";
import { Zone } from "../patterns/time";
import { goalForEvent } from "../score/match";
import type { Store } from "../store";
import { DEMO_TZ, localDate } from "./time";
import { DEMO_PLACES, demoTravel } from "./travel";
import { buildDemoWeek, DEMO_PREFIX, type DemoWeek, demoGoals } from "./week";

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
  if (!rules.offTheRecord) await seedDemoTravel(store, week, opts.now ?? new Date());
  return { days: week.days, events, goals_written: goals };
}

/**
 * The demo's places (when none are saved) and one travel suggestion for the next drive that
 * leaving later makes shorter, today or tomorrow, so it shows on Today. Google is never asked.
 */
export async function seedDemoTravel(store: Store, week: DemoWeek, now: Date): Promise<void> {
  if ((await store.listPlaces()).length === 0) await store.replacePlaces(DEMO_PLACES);
  const zone = new Zone(DEMO_TZ);
  const today = localDate(now.getTime());
  const days = [today, zone.nextDay(today)];
  const calendar = week.events.filter(
    (e) => e.type === "calendar_event" && days.includes(localDate(Date.parse(e.start_at))),
  );
  const trip = demoTravel(calendar).trips.find(
    (t) => t.wonMinutes >= 10 && Date.parse(t.naive.depart_at) > now.getTime() + 10 * 60_000,
  );
  if (!trip) return;

  const clock = (iso: string) => zone.clock(Date.parse(iso));
  const title = `Leave at ${clock(trip.best.depart_at)} instead of ${clock(trip.naive.depart_at)}, win ${trip.wonMinutes} minutes`;
  const before = await store.listRecommendations();
  if (before.some((r) => r.title === title && r.action?.undo_until === trip.best.depart_at)) return;

  const day = localDate(trip.start);
  const events = await store.listEvents({
    from: new Date(zone.startOfDay(day)).toISOString(),
    to: new Date(zone.startOfDay(zone.nextDay(day))).toISOString(),
    type: ["calendar_event"],
  });
  const event = events.find((e) => e.external_id === trip.calendarExternalId);
  if (!event) return;
  const goal = goalForEvent(event, await store.listGoals())?.goal ?? null;
  await store.createRecommendation({
    goal_id: goal?.id ?? null,
    title,
    rationale:
      `Leaving at ${clock(trip.naive.depart_at)} means ${trip.naive.minutes} minutes on the road to ${trip.to}; ` +
      `at ${clock(trip.best.depart_at)} it is ${trip.best.minutes} and you still arrive by ` +
      `${clock(trip.best.arrive_at)} for ${trip.title} at ${zone.clock(trip.start)}.`,
    action: {
      kind: "reminder",
      payload: { event_id: event.id, at: trip.best.depart_at, text: `Leave now for ${trip.to}.` },
      involves_others: false,
      undo_until: trip.best.depart_at,
    },
  });
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
