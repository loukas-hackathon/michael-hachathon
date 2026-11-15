import type { DemoSeedResult, Source } from "@michael/shared";
import { InstructionCreate } from "@michael/shared";
import { seedDemoDrafts } from "../actions/drafts";
import { currentUserId, runAsUser } from "../context";
import { env } from "../env";
import { HttpError, parse } from "../http";
import { Zone } from "../patterns/time";
import { isLogEntry } from "../score/logged";
import { goalForEvent } from "../score/match";
import type { Store } from "../store";
import { seedDemoKnowledge } from "./knowledge";
import { removeRetiredSamples } from "./retired";
import { seedDemoRitual } from "./ritual";
import { DEMO_TZ, localDate } from "./time";
import { DEMO_PLACES, demoTravel } from "./travel";
import { buildDemoWeek, DEMO_PREFIX, type DemoWeek, demoGoals, demoInstructions } from "./week";

// How long a demo visitor's chat lives: the life of the visitor cookie.
const VISITOR_CHAT_MS = 24 * 60 * 60_000;

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
  opts: { overwriteGoals: boolean; resetState?: boolean; now?: Date },
): Promise<DemoSeedResult> {
  if (currentUserId() !== env.DEMO_USER_ID)
    throw new HttpError("forbidden", "Only the demo account has a demo week");
  const now = opts.now ?? new Date();
  const week = buildDemoWeek(now);

  // A reset puts the stage back: no visitor chat from before it, off the record off, and the goals
  // and standing instructions exactly the plan (goals added since are removed, plan goals are
  // overwritten below). Web visitors cannot change any of it (demo/visitor.ts), so this undoes
  // rehearsal changes made by Claude, the API key or by hand. Per source switches stay as the team set them: on the demo account they
  // keep real collectors out (#114). Visitor chat older than a day (the visitor cookie's life)
  // goes on every refresh.
  const resetState = opts.resetState ?? opts.overwriteGoals;
  await store.clearVisitorChat(
    resetState ? now.toISOString() : new Date(now.getTime() - VISITOR_CHAT_MS).toISOString(),
  );
  if (resetState) {
    await store.setOffTheRecord(false);
    await resetToPlan(store, week.days);
  }

  // Off the record stops the demo week too (it is the switch people try on stage). Per source
  // switches are not applied: on the demo account they keep real collectors out (#114), and
  // everything seeded here is synthetic.
  const rules = await store.privacyRules();
  const sources: Source[] = rules.offTheRecord ? [] : [...new Set(week.events.map((e) => e.source))];

  const events = await store.syncSeededEvents(DEMO_PREFIX, sources, week.events);
  const goals = await store.seedGoals(demoGoals, { overwrite: opts.overwriteGoals || resetState });
  if (!rules.offTheRecord) await seedDemoTravel(store, week, opts.now ?? new Date());
  // Follow up drafts for the latest conversations (#40). Best effort: never fails the seed.
  if (!rules.offTheRecord) {
    await seedDemoDrafts(store, (opts.now ?? new Date()).getTime(), week.days.length).catch((err) =>
      console.error("Demo drafts failed", err),
    );
  }
  // The daily ritual (#318): today's plan and two logged evenings. Best effort too.
  if (!rules.offTheRecord) {
    await seedDemoRitual(store, week.days).catch((err) => console.error("Demo ritual failed", err));
  }
  // What Michael knows (#379): a few memories and answered check ins, so the page is not empty on stage.
  if (!rules.offTheRecord) {
    await seedDemoKnowledge(store, week.days, { reset: resetState }).catch((err) =>
      console.error("Demo knowledge failed", err),
    );
  }
  // The sample brief, the sample suggestions and the retired goal never stay on the stage (#330).
  await removeRetiredSamples(store);
  return { days: week.days, events, goals_written: goals };
}

/**
 * Goals not in the plan go; the standing instructions become the plan's. Visitors may save the
 * daily ritual and log done time on stage (demo/visitor.ts), so those go back to the plan too: the
 * ritual rows of the week (and tomorrow, for a carried outcome) are cleared, the outcomes goal is
 * not in the plan so it goes with its outcomes, and every logged entry that is not the demo week's
 * own is removed. seedDemoRitual then writes the plan's ritual again.
 */
async function resetToPlan(store: Store, days: string[]): Promise<void> {
  const plan = new Set(demoGoals.map((g) => g.id));
  for (const g of await store.listGoals()) if (!plan.has(g.id)) await store.deleteGoal(g.id);
  for (const i of await store.listInstructions()) await store.deleteInstruction(i.id);
  for (const i of demoInstructions) await store.createInstruction(parse(InstructionCreate, i));

  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return;
  const zone = new Zone(DEMO_TZ);
  const tomorrow = zone.nextDay(last);
  await store.clearRituals({ from: first, to: tomorrow });
  const manual = await store.listEvents({
    from: new Date(zone.startOfDay(first)).toISOString(),
    to: new Date(zone.startOfDay(zone.nextDay(tomorrow))).toISOString(),
    source: ["manual"],
  });
  const logged = manual.filter((e) => isLogEntry(e) && !e.external_id?.startsWith(DEMO_PREFIX));
  if (logged.length) await store.deleteEvents(logged.map((e) => e.id));
  // Focus now sessions (#397) and the blocks they made on the demo day.
  const focusBlocks = await store.clearFocusSessions();
  if (focusBlocks.length) await store.deleteEvents(focusBlocks);
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

/** True once a refresh has finished since the process started (the week is in the database). */
export const demoWeekSeeded = () => goalsReset;

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

/**
 * Starts the first refresh as the process starts (#364), so the first demo visitor after a deploy
 * finds the week ready instead of waiting for the reset and about 20 round trips of seeding.
 */
export function warmDemoWeek(store: Store): Promise<void> {
  if (env.DEMO_WEEK !== "on") return Promise.resolve();
  return runAsUser(env.DEMO_USER_ID, () => keepDemoWeekFresh(store));
}

// The longest a demo request waits for the first refresh after a start. The week from before the
// deploy is still in the database, so waiting longer only matters on a brand new database.
export const FIRST_REFRESH_WAIT_MS = 2000;

/**
 * What a demo request waits for: nothing once a refresh has finished; before that, the first
 * refresh, but at most `waitMs`. The refresh carries on in the background either way.
 */
export function demoRefreshGate(refresh: Promise<void>, waitMs = FIRST_REFRESH_WAIT_MS): Promise<void> {
  if (demoWeekSeeded()) return Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  return Promise.race([refresh, cap]).finally(() => clearTimeout(timer));
}
