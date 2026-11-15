import type { Score } from "@michael/shared";

// Keep the Day (Manolis picked option C, 15 Nov): a day is kept when its optimisation score
// reaches the line (the week's target, else 70%). Days without goal blocks neither keep nor break
// the run, so a clear Sunday is a rest day, never a loss.

export const DEFAULT_LINE = 70;
const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type KeepState = "kept" | "missed" | "open" | "free" | "future";

export type KeepDay = {
  date: string;
  /** Planned and spent goal minutes; pct is spent of planned, null without planned time. */
  planned: number;
  spent: number;
  pct: number | null;
  state: KeepState;
  /** One of the user's rest days (a "keep clear" day): no line, it never counts. */
  rest: boolean;
};

export type KeepWeek = {
  today: string;
  /** The line a day must reach, in percent. */
  line: number;
  /** True when the line is the week's target, false when it is the default. */
  lineFromTarget: boolean;
  days: KeepDay[];
  /** Days kept in a row, counting back from today (today only once it is kept). */
  streak: number;
  /** Today: goal minutes still needed to keep it; 0 once kept; null without planned time. */
  need: number | null;
  /** Week days that are always free of goal blocks (rest days), by name. */
  restDays: string[];
};

function stateOf(
  d: { date: string; planned: number; spent: number },
  today: string,
  line: number,
): KeepState {
  if (d.date > today) return "future";
  if (d.planned <= 0) return "free";
  const pct = (d.spent / d.planned) * 100;
  if (pct >= line) return "kept";
  return d.date === today ? "open" : "missed";
}

function daysOf(score: Score, today: string, line: number, restDays: string[] = []): KeepDay[] {
  return score.days.map((d, i) => ({
    rest: restDays.includes(WEEKDAY[i] as string) && d.planned_minutes <= 0,
    date: d.date,
    planned: d.planned_minutes,
    spent: d.spent_minutes,
    pct: d.planned_minutes > 0 ? Math.round((d.spent_minutes / d.planned_minutes) * 100) : null,
    state: stateOf({ date: d.date, planned: d.planned_minutes, spent: d.spent_minutes }, today, line),
  }));
}

/** `week` holds today; `before` is the week before it (for a run that started last week). */
export function keepWeekFrom(
  week: Score,
  before: Score | null,
  today: string,
  restDays: string[] = [],
): KeepWeek {
  const target = week.target?.overall_pct ?? null;
  const line = target ?? DEFAULT_LINE;
  const days = daysOf(week, today, line, restDays);
  const earlier = before ? daysOf(before, today, before.target?.overall_pct ?? line) : [];

  let streak = 0;
  for (const d of [...earlier, ...days].reverse()) {
    if (d.state === "future" || d.state === "open" || d.state === "free") continue;
    if (d.state === "missed") break;
    streak++;
  }

  const t = days.find((d) => d.date === today);
  const need = t && t.planned > 0 ? Math.max(0, Math.ceil((line / 100) * t.planned - t.spent)) : null;
  return { today, line, lineFromTarget: target != null, days, streak, need, restDays };
}

/** Rest days from the standing instructions: "Keep Sundays clear" makes Sunday a rest day. */
export function restDaysFrom(instructions: { kind: string; days?: number[] | null; active: boolean }[]) {
  const set = new Set<number>();
  for (const i of instructions)
    if (i.active && i.kind === "clear_day") for (const d of i.days ?? []) set.add(d);
  // Instructions use 0 = Sunday; WEEKDAY is Monday first.
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => set.has(d)).map((d) => WEEKDAY[(d + 6) % 7] as string);
}

export const weekdayName = (i: number) => WEEKDAY[i] as string;
