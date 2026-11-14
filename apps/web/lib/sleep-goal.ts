import "server-only";
import { type Goal, isSleepGoal } from "@michael/shared";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Minutes a night the sleep goal asks for: `sleep_hours`, else its weekly budget over 7. */
export function sleepGoalMinutes(goals: Goal[]): number | null {
  const goal = goals.find((g) => g.active && isSleepGoal(g));
  if (!goal) return null;
  const hours = num(goal.target?.sleep_hours);
  if (hours) return Math.round(hours * 60);
  return goal.weekly_budget_minutes ? Math.round(goal.weekly_budget_minutes / 7) : null;
}
