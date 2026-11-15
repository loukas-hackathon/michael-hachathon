import type { Category } from "./categories";
import type { ChecklistProgress, CountProgress } from "./checklist";
import type { Balance, Baseline, WeeklyTarget } from "./gamification";
import type { ScoreExplain } from "./score-explain";

// The week as the Goals tab sees it. GET /v1/score has per goal totals (GoalScore) but not the
// per day minutes or sleep; until it does (issue for the contract), lib/api.ts serves a sample week
// in this local shape.

export type GoalWeek = {
  id: string;
  title: string;
  category: Category;
  budgetMinutes: number;
  spentMinutes: number;
  /** The part of spentMinutes no data proves yet (drawn pale pink). */
  unverifiedMinutes: number;
  /** Minutes planned in calendar blocks this week, and how many of those blocks are still to come. */
  plannedMinutes?: number;
  openBlocks?: number;
  /** From the API when it says so (sleep and other unscored goals: 0). */
  leftMinutes?: number;
  /** time (default), checklist or count (#131, #238). Only time goals are in the score. */
  kind?: "time" | "checklist" | "count";
  checklist?: ChecklistProgress;
  count?: CountProgress;
  /** Minutes per day, Monday first. Days after today are null. */
  daily: (number | null)[];
};

export type SleepWeek = {
  goalMinutes: number;
  /** Minutes asleep per night, Monday first; null for nights not yet slept. */
  nightly: (number | null)[];
};

export type GoalsView = {
  sample: boolean;
  /** Monday 00:00 of the week and "now", both ISO. */
  weekStart: string;
  now: string;
  /** Free time left this week outside fixed commitments, from the calendar. Null until known. */
  freeMinutesLeft: number | null;
  goals: GoalWeek[];
  /** Checklist and count goals: shown in their area, outside the time score (#238). */
  extras?: GoalWeek[];
  sleep: SleepWeek | null;
  target?: WeeklyTarget | null;
  baseline?: Baseline | null;
  balance?: Balance | null;
  /** Michael's line for a personal best this week (never a baseline). */
  recordLine?: string | null;
  /** The week's maths for the "How I count" sheet (#206). */
  explain?: ScoreExplain | null;
};

const WEEK_MS = 7 * 86_400_000;

/** Share of the week gone by, 0 to 1: where every goal should be by now if spread evenly. */
export function pace(view: GoalsView) {
  const p = (new Date(view.now).getTime() - new Date(view.weekStart).getTime()) / WEEK_MS;
  return Math.min(1, Math.max(0, p));
}

export function todayIndex(view: GoalsView) {
  return Math.min(6, Math.floor(pace(view) * 7));
}

export type GoalStatus = {
  goal: GoalWeek;
  share: number;
  behindBy: number;
  leftMinutes: number;
  behind: boolean;
};

/** Goals with how far each is from pace, furthest behind first. */
export function rank(view: GoalsView): GoalStatus[] {
  const p = pace(view);
  return view.goals
    .filter((goal) => (goal.kind ?? "time") === "time")
    .map((goal) => {
      const share = goal.budgetMinutes > 0 ? goal.spentMinutes / goal.budgetMinutes : 1;
      return {
        goal,
        share,
        behindBy: p - share,
        leftMinutes: goal.leftMinutes ?? Math.max(0, goal.budgetMinutes - goal.spentMinutes),
        behind: share < p - 0.02,
      };
    })
    .sort((a, b) => b.behindBy - a.behindBy);
}

/**
 * How close a goal is to closing for the week, for the "close it" pull on Goals (Apple's rings,
 * a streak about to land). near: three quarters done or an hour left. last: one block closes it.
 */
export type CloseState = "open" | "near" | "last" | "closed";
export function closeState(budget: number, spent: number, left: number): CloseState {
  if (budget <= 0) return "open";
  if (left <= 0) return "closed";
  if (left <= 30) return "last";
  if (left <= 60 || spent / budget >= 0.75) return "near";
  return "open";
}

/** Where an even week would have the goal by now, in minutes ("on pace: 5h 10 by now"). */
export function paceMinutes(budget: number, p: number) {
  return Math.round(budget * p);
}

/**
 * How long a block "Book time" offers (#309): what is left spread over the days to go, today
 * included, in quarter hours between 30 and 90 minutes, and never more than what is left.
 */
export function bookMinutes(left: number, daysToGo: number) {
  const q = (m: number) => Math.ceil(m / 15) * 15;
  const even = q(left / Math.max(1, daysToGo));
  return Math.max(15, Math.min(q(left), Math.max(30, Math.min(90, even))));
}

/**
 * The goal that needs the user most this week: the furthest behind pace, else (all on pace) the
 * one with the most still to find. Null when every time goal is closed.
 */
export function needsMost(ranked: GoalStatus[]): GoalStatus | null {
  const open = ranked.filter((r) => r.leftMinutes > 0);
  const behind = open.find((r) => r.behind);
  if (behind) return behind;
  return [...open].sort((a, b) => b.leftMinutes - a.leftMinutes)[0] ?? null;
}
