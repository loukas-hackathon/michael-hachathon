import { EmptyState } from "@/components/empty-state";
import { getGoals, getGoalsWeek } from "@/lib/api";
import { getSetup, getStartedDismissed, SETUP_LINKS } from "@/lib/first-run";
import { rank } from "@/lib/goals-view";
import {
  calendarMissingLine,
  emptyDayLines,
  furthestBehind,
  setupWhy,
  weekdayIndex,
} from "@/lib/today-lines";

/** No calendar yet: what that costs their goals, by name and budget. */
async function calendarLine() {
  const goals = (await getGoals().catch(() => [])).filter((g) => g.active);
  return calendarMissingLine(
    goals.map((g) => ({ title: g.title, budgetMinutes: g.weekly_budget_minutes, category: g.category })),
  );
}

/** Goals and calendar in, nothing booked today: the goal furthest behind, and the one tap. */
async function planLines(weekday: number) {
  const week = await getGoalsWeek().catch(() => null);
  const l = emptyDayLines(week ? furthestBehind(rank(week)) : null, weekday);
  return [l.title, l.line, l.cta, "/chat"] as const;
}

const action =
  "hit press inline-flex min-h-9 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text";

/**
 * Today with no goal time planned: one sentence from Michael and the one thing that fills it.
 * Goals come first, then the calendar they are measured against, then a plan for today. Each line
 * is about the person: the days left in their week, their goals by name and what is left of them.
 */
export async function TodayEmpty({ demo }: { demo?: string }) {
  // Previews (?demo=empty) keep the sample's line.
  if (demo)
    return (
      <EmptyState title="Nothing yet.">
        Wear the watch tonight. I'll have your first brief ready by breakfast.
      </EmptyState>
    );

  // No setup for the shared demo account: it has goals and a calendar, so it gets the plan line.
  const setup = await getSetup();
  const done = (key: string) => !setup || setup.steps.some((s) => s.key === key && s.done);
  // The Get started card already leads with goals or the calendar: one action, not two.
  if (setup && (!done("goals") || !done("calendar")) && !(await getStartedDismissed())) return null;
  const weekday = weekdayIndex(new Date().toISOString());

  const [title, line, label, href] = !done("goals")
    ? ["No goals yet.", setupWhy("goals", [], weekday), "Set your first goal", SETUP_LINKS.goals]
    : !done("calendar")
      ? ["Nothing planned today.", await calendarLine(), "Connect your calendar", SETUP_LINKS.calendar]
      : await planLines(weekday);

  return (
    <EmptyState
      title={title}
      action={
        <a href={href} className={action}>
          {label}
        </a>
      }
    >
      {line}
    </EmptyState>
  );
}
