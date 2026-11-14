import "server-only";
import type { Score } from "@michael/shared";
import { getScore } from "./api";

// The first minute's number (docs/ux-audit.md, "Proposed first minute"): the week as Michael sees it
// from the calendar alone, the moment Google Calendar is connected. Real numbers only: the planned
// minutes are the user's own calendar blocks that belong to a goal, from GET /v1/score.

export type FirstInsightGoal = { title: string; planned: number; budget: number };

export type FirstInsight = {
  /** Planned goal time this week, Monday to Sunday, in minutes. */
  planned: number;
  /** What the goals ask for this week, in minutes. */
  budget: number;
  goals: FirstInsightGoal[];
  /** True for the ?demo=connected preview, so the screen can say the numbers are sample. */
  sample?: boolean;
};

/** Time goals with a weekly budget: the ones a calendar block can count towards (sleep is apart). */
export function insightFromScore(score: Pick<Score, "goals">): FirstInsight | null {
  const goals = score.goals
    .filter((g) => g.scored && g.budget_minutes > 0)
    .map((g) => ({ title: g.title, planned: g.planned_minutes, budget: g.budget_minutes }));
  if (goals.length === 0) return null;
  return {
    planned: goals.reduce((n, g) => n + g.planned, 0),
    budget: goals.reduce((n, g) => n + g.budget, 0),
    goals,
  };
}

/** This week's insight for the signed-in user, or null when it cannot be read. */
export async function getFirstInsight(): Promise<FirstInsight | null> {
  try {
    return insightFromScore(await getScore());
  } catch {
    return null;
  }
}

/** For ?demo=connected only: the screen in its connected state, clearly marked sample. */
export const SAMPLE_INSIGHT: FirstInsight = {
  planned: 14 * 60,
  budget: 29 * 60,
  goals: [
    { title: "Deep work", planned: 10 * 60, budget: 20 * 60 },
    { title: "Training", planned: 3 * 60, budget: 4 * 60 },
    { title: "Proper meals", planned: 60, budget: 5 * 60 },
  ],
  sample: true,
};
