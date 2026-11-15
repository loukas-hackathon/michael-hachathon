import {
  type ChecklistItem,
  type Event,
  type Goal,
  type Instruction,
  type PersonalRecord,
  type Score,
  voiceDuration,
  type WeeklyTarget,
  type WeekReview,
  type WeekReviewGoal,
  type WeekReviewMove,
} from "@michael/shared";
import { goalBooking } from "../goals/book";
import { goalBlocks } from "../patterns/focus";
import { MINUTE, Zone } from "../patterns/time";
import { median } from "../patterns/util";
import { goalBlockTitle, proposeTarget, type ScoreHistory, scoreRange, targetWeek } from "../score";
import { LOG_SOURCE } from "../score/logged";
import { timeAreasOf } from "../score/targets";
import { commitments, committedMinutes, wakingDay } from "../score/week";

// Your week (#376): the Sunday evening review, on demand any time. Pure: the score, its history,
// the stored records and targets, the week's events and outcomes and next week's calendar go in;
// the review comes out. No I/O and no clock. Every number is one the score, the target rule
// (#165), the records (#166), the done time log (#317) or the ritual (#318) already made; this
// file only picks and words them.
//
//   Score         The score's week (GET /v1/score): spent / elapsed, with planned, lost and
//                 unverified beside it. Usual: the median of the full weeks before (at most 4,
//                 at least 2, the target rule's history).
//   Won back      The score's time won back: the sum of the days against the usual loss rate.
//   Goals         Time goals with a budget: held in blocks plus logged outside them (the budget
//                 maths, #372), kept when that reaches the budget. Count goals: sessions done
//                 against sessions a week. Targets (sleep) and checklists are left out.
//   Records       New bests set in the week (a baseline is never announced, so never here). The
//                 longest unbroken verified run inside one block is shown beside them, record or not.
//   Thief         The first entry of the score's `lost_by`, with its share of the lost minutes.
//   Logged        The user's done time entries (#317) that start in the week.
//   Outcomes      The ritual's outcomes in the week: set (moved ones left out) and done.
//   Lesson        One line from the facts above (see `lessonFor`); a model may rephrase it under
//                 the moments' number guard (week/phrase.ts).
//   Next week     The target stored for next Monday, else Michael's proposal by the target rule,
//                 reading the reviewed week as full from its Sunday on (the review is the
//                 Sunday evening moment); else the reason the baseline is not ready.
//   Next move     Next week's first goal block when one is booked. Otherwise a block for the goal
//                 furthest short this week (ties: the bigger budget), a fifth of its budget in
//                 quarter hours, 30 to 90 minutes, in the first free slot from Monday on that
//                 Book would take (goals/book.ts: waking day, calendar, standing instructions).

export const REVIEW_RULES = {
  usualWeeksMin: 2,
  usualWeeksMax: 4,
  moveMinMinutes: 30,
  moveMaxMinutes: 90,
  /** A thief under this many minutes is not the week's lesson. */
  thiefMinMinutes: 15,
} as const;

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayOf = (day: string): string => WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()] ?? day;

export interface ReviewInput {
  score: Score;
  history: ScoreHistory;
  goals: Goal[];
  /** Every stored record of the user. */
  records: PersonalRecord[];
  /** Stored targets around the week: the reviewed week's history and next Monday's. */
  targets: WeeklyTarget[];
  /** The events the score read (done time entries among them). */
  events: Event[];
  /** The week's checklist items. */
  checklist: ChecklistItem[];
  /** The checklist goal that holds the ritual's outcomes, if any. */
  outcomesGoalId: string | null;
  /** Calendar events of next week (Monday to Sunday). */
  nextEvents: Event[];
  instructions: Instruction[];
  now: string;
}

export type ReviewCore = Omit<WeekReview, "lesson" | "phrased_by"> & { lesson: string };

const round15 = (m: number) => Math.round(m / 15) * 15;

/** Goals kept or behind, time goals first in the score's order. */
export function reviewGoals(score: Score): WeekReviewGoal[] {
  const rows: WeekReviewGoal[] = [];
  for (const g of score.goals) {
    if (g.kind === "time" && g.scored && g.budget_minutes > 0) {
      const done = g.spent_minutes + (g.logged_minutes ?? 0);
      rows.push({
        goal_id: g.goal_id,
        title: g.title,
        area: g.area,
        kind: "time",
        done,
        budget: g.budget_minutes,
        planned_ahead: g.ahead_minutes,
        kept: done >= g.budget_minutes,
        short: Math.max(0, g.budget_minutes - done),
      });
    } else if (g.kind === "count" && g.count && g.count.target > 0) {
      rows.push({
        goal_id: g.goal_id,
        title: g.title,
        area: g.area,
        kind: "count",
        done: g.count.done,
        budget: g.count.target,
        planned_ahead: 0,
        kept: g.count.done >= g.count.target,
        short: Math.max(0, g.count.target - g.count.done),
      });
    }
  }
  return rows;
}

/** Median of the full weeks before the reviewed one, with how many it read; null with fewer than 2. */
export function usualScore(history: ScoreHistory, weekStart: string): { pct: number | null; weeks: number } {
  const full = history.weeks
    .filter((w) => w.complete && w.score_pct !== null && w.week_start < weekStart)
    .slice(-REVIEW_RULES.usualWeeksMax);
  if (full.length < REVIEW_RULES.usualWeeksMin) return { pct: null, weeks: full.length };
  return { pct: Math.round(median(full.map((w) => w.score_pct as number))), weeks: full.length };
}

/** The lesson without a model. Numbers only from the review. */
export function lessonFor(r: Omit<ReviewCore, "lesson">): string {
  const t = r.thief;
  if (t && t.minutes >= REVIEW_RULES.thiefMinMinutes) {
    return `${t.what} took ${voiceDuration(t.minutes)} of your goal blocks, ${t.share_pct}% of all you lost. Keep it out of next week's blocks.`;
  }
  const behind = [...r.goals]
    .filter((g) => g.kind === "time" && !g.kept)
    .sort((a, b) => b.short - a.short)[0];
  if (behind && r.complete) {
    return `${behind.title} ended ${voiceDuration(behind.short)} short. Book it before anything else next week.`;
  }
  if (behind) return `${behind.title} is ${voiceDuration(behind.short)} short with the week nearly done.`;
  if (r.score.planned_minutes === 0)
    return "No goal time was booked this week. Book next week before Monday starts.";
  if (r.goals.length > 0) return "Every goal kept. Book next week the same way.";
  return "Nothing lost from your goal blocks. Book next week the same way.";
}

/** Next week's first move: the first goal block already booked, else one to book. */
export function nextMove(
  input: Pick<ReviewInput, "goals" | "nextEvents" | "instructions" | "now">,
  goals: WeekReviewGoal[],
  nextDays: string[],
  zone: Zone,
  complete = true,
): WeekReviewMove | null {
  const first = nextDays[0];
  const last = nextDays[nextDays.length - 1];
  if (!first || !last) return null;
  const from = zone.startOfDay(first);
  const to = zone.startOfDay(zone.nextDay(last));
  const now = Date.parse(input.now);
  const booked = goalBlocks(input.nextEvents, input.goals, from, to)
    .filter((b) => b.start > now)
    .sort((a, b) => a.start - b.start)[0];
  if (booked) {
    const minutes = Math.round((booked.end - booked.start) / MINUTE);
    const day = weekdayOf(zone.dayOf(booked.start));
    return {
      title: `${booked.goal.title}, ${day} ${zone.clock(booked.start)}`,
      rationale: `Already booked: ${voiceDuration(minutes)} for ${booked.goal.title}. Next week starts there.`,
      status: "booked",
      goal_id: booked.goal.id,
      minutes,
      start_at: new Date(booked.start).toISOString(),
      end_at: new Date(booked.end).toISOString(),
    };
  }
  const byId = new Map(input.goals.map((g) => [g.id, g]));
  const pick = goals
    .filter((g) => g.kind === "time" && byId.get(g.goal_id)?.active)
    .sort((a, b) => b.short - a.short || b.budget - a.budget)[0];
  const goal = pick ? byId.get(pick.goal_id) : undefined;
  if (!pick || !goal) return null;
  const minutes = Math.min(
    REVIEW_RULES.moveMaxMinutes,
    Math.max(REVIEW_RULES.moveMinMinutes, round15(pick.budget / 5)),
  );
  const found = goalBooking({
    now,
    minutes,
    title: goalBlockTitle(goal),
    goals: input.goals,
    events: input.nextEvents,
    instructions: input.instructions,
    days: nextDays,
  });
  if (!found.slot) return null;
  const day = weekdayOf(zone.dayOf(found.slot.start));
  const why =
    pick.short > 0
      ? `${goal.title} ${complete ? "ended" : "is"} ${voiceDuration(pick.short)} short this week.`
      : `${goal.title} is ${voiceDuration(pick.budget)} a week.`;
  return {
    title: `Book ${voiceDuration(found.minutes)} for ${goal.title}, ${day} ${zone.clock(found.slot.start)}`,
    rationale: `${why} The first free slot next week starts it.`,
    status: "book",
    goal_id: goal.id,
    minutes: found.minutes,
    start_at: new Date(found.slot.start).toISOString(),
    end_at: new Date(found.slot.end).toISOString(),
  };
}

export function computeReview(input: ReviewInput): ReviewCore {
  const { score, history } = input;
  const zone = new Zone(score.timezone);
  const now = Date.parse(input.now);
  const days = score.days.map((d) => d.date);
  const monday = days[0] ?? score.date;
  const sunday = days[6] ?? score.date;
  const weekEnd = zone.startOfDay(zone.nextDay(sunday));
  const complete = now >= weekEnd;
  const inWeek = new Set(days);

  const usual = usualScore(history, monday);
  const goals = reviewGoals(score);

  const records = input.records
    .filter((r) => inWeek.has(r.achieved_on) && r.previous_value !== null)
    .sort((a, b) => a.achieved_on.localeCompare(b.achieved_on));
  const run = history.runs
    .filter((r) => inWeek.has(r.day))
    .sort((a, b) => b.minutes - a.minutes || a.end - b.end)[0];

  const top = score.lost_by?.[0];
  const thief =
    top && score.lost_minutes > 0
      ? {
          what: top.what,
          kind: top.kind,
          minutes: top.minutes,
          share_pct: Math.min(100, Math.round((top.minutes / score.lost_minutes) * 100)),
        }
      : null;

  // Done time the user logged (#317), counted where it starts.
  const weekStart = zone.startOfDay(monday);
  let entries = 0;
  let loggedMs = 0;
  for (const e of input.events) {
    if (e.source !== LOG_SOURCE || e.type !== "focus_session" || e.data?.log !== "done" || !e.end_at)
      continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    if (!(start >= weekStart && start < weekEnd && end > start)) continue;
    entries++;
    loggedMs += end - start;
  }

  const outcomes = input.checklist.filter(
    (i) => i.goal_id === input.outcomesGoalId && inWeek.has(i.date) && i.status !== "moved",
  );

  // Next week's target: stored, else the target rule with this week read as full from Sunday on.
  const nextMonday = zone.nextDay(monday, 7);
  const nextDays = Array.from({ length: 7 }, (_, i) => zone.nextDay(nextMonday, i));
  const storedByWeek = new Map(input.targets.map((t) => [t.week_start, t]));
  const stored = storedByWeek.get(nextMonday) ?? null;
  const sundayStarted = now >= zone.startOfDay(sunday);
  let next: ReviewCore["next_week"];
  if (stored) {
    next = {
      week_start: nextMonday,
      target_pct: stored.overall_pct,
      status: stored.status,
      reason: stored.reason,
    };
  } else {
    const blocks = goalBlocks(
      input.nextEvents,
      input.goals,
      zone.startOfDay(nextMonday),
      scoreRange(nextMonday, zone.name).to,
    );
    const committed = committedMinutes(
      zone,
      nextDays,
      wakingDay(input.goals.filter((g) => g.active)),
      commitments(input.nextEvents, new Set(blocks.map((b) => b.eventId))),
    );
    const { proposal, baseline } = proposeTarget({
      week_start: nextMonday,
      history: history.weeks.map((w) => ({
        ...targetWeek(w, storedByWeek.get(w.week_start) ?? null),
        complete: w.complete || (w.week_start === monday && sundayStarted),
      })),
      timeAreas: timeAreasOf(score),
      committed_minutes: committed,
    });
    next = {
      week_start: nextMonday,
      target_pct: proposal?.overall_pct ?? null,
      status: proposal ? "proposed" : null,
      reason: proposal?.reason ?? baseline.reason,
    };
  }

  const base: Omit<ReviewCore, "lesson"> = {
    week_start: monday,
    week_end: sunday,
    timezone: score.timezone,
    generated_at: score.generated_at,
    complete,
    score: {
      pct: score.score_pct === null ? null : Math.round(score.score_pct),
      planned_minutes: score.planned_minutes,
      elapsed_minutes: score.elapsed_minutes,
      spent_minutes: score.spent_minutes,
      lost_minutes: score.lost_minutes,
      ahead_minutes: score.ahead_minutes,
      unverified_minutes: score.unverified_minutes,
      usual_pct: usual.pct,
      usual_weeks: usual.weeks,
      target_pct: score.target?.overall_pct ?? null,
      on_target: score.on_target,
    },
    won_back_minutes: score.time_won_back_minutes,
    logged_outside_minutes: score.logged_minutes ?? 0,
    goals,
    records,
    best_block: run
      ? { goal_id: run.goal_id, goal_title: run.goal_title, day: run.day, minutes: run.minutes }
      : null,
    thief,
    logged: { entries, minutes: Math.round(loggedMs / MINUTE) },
    outcomes: { set: outcomes.length, done: outcomes.filter((i) => i.status === "done").length },
    next_week: next,
    next_move: nextMove(input, goals, nextDays, zone, complete),
  };
  return { ...base, lesson: lessonFor(base) };
}
