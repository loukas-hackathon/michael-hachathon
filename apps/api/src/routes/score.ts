import {
  type ChecklistItem,
  type Event,
  type EventType,
  type Goal,
  type PersonalRecord,
  type Score,
  ScoreQuery,
  type TargetBaseline,
  type WeeklyTarget,
} from "@michael/shared";
import { Hono } from "hono";
import { offerGoalActions } from "../checklist/offers";
import { HttpError, parse } from "../http";
import { memo } from "../memo";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import {
  countCheckInsFrom,
  detectRecords,
  isLocalDay,
  type Proposal,
  proposeTarget,
  type ScoreHistory,
  scoreRange,
  scoreTarget,
  scoreWithHistory,
  targetWeek,
  withTarget,
} from "../score";
import { timeAreasOf } from "../score/targets";
import { store } from "../store";

// What the score is built from: the plan (calendar), proof of training (workouts), sleep (outside
// the score, for the week's nights) and the device events the single line of attention is made of.
// Plus the user's own word (#317): logged done time (focus_session) and blocks settled as not done
// (note), both source manual (score/logged.ts).
// How much of the score range one read covers (see loadWeek).
const READ_STEP_MS = 2 * 24 * 3600_000;

export const TYPES: EventType[] = [
  "calendar_event",
  "workout",
  "sleep",
  "app_usage",
  "web_visit",
  "screen",
  "focus_session",
  "note",
];
export interface Week {
  score: Score;
  history: ScoreHistory;
  goals: Goal[];
  /** Every event the score was built from (the five weeks), for readers that need more (#376). */
  events: Event[];
  /** The week's checklist items (#238), the ritual's outcomes among them (#318). */
  checklist: ChecklistItem[];
  now: string;
  /** False when `now` is in the future: a replay that must not write records. */
  real: boolean;
}

/**
 * The one place that reads the clock and the store for a score; the functions under ../score stay
 * pure. `date` defaults to today in Europe/Athens. `now` replays a day as it stood at that instant.
 */
export async function loadWeek(query: { date?: string; now?: string }): Promise<Week> {
  const q = parse(ScoreQuery, query);
  const clock = Date.now();
  const now = q.now ?? new Date(clock).toISOString();
  const date = q.date ?? new Zone(DEFAULT_TIMEZONE).dayOf(Date.parse(now));
  if (!isLocalDay(date)) throw new HttpError("bad_request", "`date` must be a real day, YYYY-MM-DD");

  const range = scoreRange(date);
  // Five weeks of events, read two days at a time side by side: a busy week of app and web
  // activity is thousands of rows, and one read pages through them one round trip after another
  // (#364). An event on a border comes back twice and is kept once.
  // The store returns every row of a window, however many (#127).
  const iso = (ms: number) => new Date(ms).toISOString();
  const chunks: Promise<Event[]>[] = [];
  for (let start = range.from; start < range.to; start += READ_STEP_MS) {
    chunks.push(
      store.listEvents({ from: iso(start), to: iso(Math.min(start + READ_STEP_MS, range.to)), type: TYPES }),
    );
  }
  // The week itself, for the checklist and count rows (#238): its items and the check in's
  // answers. Extras, like the flags.
  const monday = range.days[0] ?? date;
  const sunday = range.days[6] ?? date;
  const [goals, instructions, checklist, checkIns, ...pages] = await Promise.all([
    store.listGoals(),
    // The flags on the blocks are an extra: a failed read here must never take the score down.
    store.listInstructions().catch(() => []),
    store.listChecklist({ from: monday, to: sunday }).catch(() => []),
    store.listCheckIns({ fromDay: monday, toDay: sunday }).catch(() => []),
    ...chunks,
  ]);
  const byId = new Map<string, Event>();
  for (const page of pages) for (const e of page) byId.set(e.id, e);
  const events = [...byId.values()];
  const built = scoreWithHistory(events, goals, {
    date,
    now,
    instructions,
    checklist,
    countCheckIns: countCheckInsFrom(checkIns),
  });
  return { ...built, goals, events, checklist, now, real: Date.parse(now) <= clock };
}

export interface TargetState {
  /** The stored target for the week, else Michael's proposal (not stored), else null. */
  target: WeeklyTarget | null;
  /** Michael's proposal from the history, stored or not. */
  proposal: Proposal | null;
  stored: WeeklyTarget | null;
  baseline: TargetBaseline;
}

/** The week's target: what is stored for it, and what Michael proposes from the weeks before. */
export async function targetState(week: Week): Promise<TargetState> {
  const zone = new Zone(week.score.timezone);
  const monday = zone.dayOf(Date.parse(week.score.week_start));
  const stored = await store.listTargets(zone.nextDay(monday, -28), monday);
  const byWeek = new Map(stored.map((t) => [t.week_start, t]));
  const current = week.history.weeks.find((w) => w.week_start === monday);
  const { proposal, baseline } = proposeTarget({
    week_start: monday,
    history: week.history.weeks.map((w) => targetWeek(w, byWeek.get(w.week_start) ?? null)),
    timeAreas: timeAreasOf(week.score),
    committed_minutes: current?.committed_minutes ?? 0,
  });
  const own = byWeek.get(monday) ?? null;
  const target = own ?? (proposal ? { ...proposal, created_at: week.now, updated_at: week.now } : null);
  return { target, proposal, stored: own, baseline };
}

/**
 * Records from the score history, written once: new ones are inserted under a unique key per
 * period, so reading the score again writes nothing. Returns every stored record of the user.
 */
export async function syncRecords(week: Week): Promise<PersonalRecord[]> {
  const stored = await store.listRecords();
  if (!week.real) return stored;
  const fresh = detectRecords({ weeks: week.history.weeks, runs: week.history.runs, stored });
  if (fresh.length === 0) return stored;
  const inserted = await store.insertRecords(fresh);
  return [...stored, ...inserted];
}

/** The score with the week's target, the balanced week and the records set in it. */
/**
 * `readOnly`: the numbers only, for the chat context (#364): personal records are not synced and
 * today's goal offers are not made, which saves their round trips (the screens still do both).
 */
export function scoreFor(
  query: { date?: string; now?: string },
  opts: { readOnly?: boolean } = {},
): Promise<Score> {
  // At the real clock, the same score is reused for a few seconds until the user writes (memo.ts,
  // #298). A replay (`now`) is always computed.
  if (query.now !== undefined) return computeScore(query, opts);
  return memo("score", { date: query.date ?? null, readOnly: !!opts.readOnly }, SCORE_MEMO_MS, () =>
    computeScore(query, opts),
  );
}

// Long enough to serve one screen's several reads (Today asks three times), short enough that
// the minutes on the tape keep moving.
const SCORE_MEMO_MS = 20_000;

async function computeScore(query: { date?: string; now?: string }, opts: { readOnly?: boolean }) {
  return scoreOfWeek(await loadWeek(query), opts);
}

/** The score of a week already loaded (loadWeek), with its target, records and offers. */
export async function scoreOfWeek(week: Week, opts: { readOnly?: boolean } = {}): Promise<Score> {
  // Targets and records are extras: a failed read must never take the score down.
  const [state, records] = await Promise.all([
    targetState(week).catch((err) => {
      console.error("score: target", err);
      return null;
    }),
    opts.readOnly
      ? ([] as PersonalRecord[])
      : syncRecords(week).catch((err) => {
          console.error("score: records", err);
          return [] as PersonalRecord[];
        }),
  ]);
  // Today's offers for checklist and count goals (checklist/offers.ts), made once a day through
  // the instruction guard. Only from a score of the current week read at the real clock.
  const today = new Zone(DEFAULT_TIMEZONE).dayOf(Date.now());
  if (
    !opts.readOnly &&
    week.real &&
    Date.now() - Date.parse(week.now) < 60_000 &&
    week.score.days.some((d) => d.date === today)
  ) {
    await offerGoalActions({ rows: week.score.goals }).catch((err) => console.error("score: offers", err));
  }
  const s = withTarget(week.score, state?.target ? scoreTarget(state.target) : null);
  const days = new Set(s.days.map((d) => d.date));
  const inWeek = records.filter((r) => days.has(r.achieved_on));
  // The tape marks a block where a new best (not a baseline) was set.
  const marks = new Map(
    inWeek
      .filter((r) => r.type === "longest_block" && r.previous_value !== null && r.achieved_on === s.date)
      .map((r) => [r.event_id, r.id]),
  );
  return {
    ...s,
    records: inWeek,
    day: { ...s.day, blocks: s.day.blocks.map((b) => ({ ...b, record_id: marks.get(b.event_id) ?? null })) },
  };
}

export const score = new Hono()
  // GET /v1/score?date=YYYY-MM-DD  (default: today in Europe/Athens; `week` is the old name of `date`)
  .get("/score", async (c) => {
    const body = await scoreFor({
      date: c.req.query("date") ?? c.req.query("week"),
      now: c.req.query("now"),
    });
    return c.json(body);
  });
