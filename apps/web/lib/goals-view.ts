import type { Category } from "./categories";

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
  sleep: SleepWeek | null;
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
    .map((goal) => {
      const share = goal.budgetMinutes > 0 ? goal.spentMinutes / goal.budgetMinutes : 1;
      return {
        goal,
        share,
        behindBy: p - share,
        leftMinutes: Math.max(0, goal.budgetMinutes - goal.spentMinutes),
        behind: share < p - 0.02,
      };
    })
    .sort((a, b) => b.behindBy - a.behindBy);
}
