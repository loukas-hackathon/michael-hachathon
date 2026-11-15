import { type Goal, goalKind } from "@michael/shared";
import { getScore } from "@/lib/api";
import type { DayView } from "@/lib/day";
import { getFocusActive } from "@/lib/focus";
import { formatTime } from "@/lib/format";
import { LENGTHS } from "./focus-events";
import { TodayFocus } from "./focus-start";

// Focus now on Today (#397): shown when a goal block is running now (one tap uses it, to its end)
// or nothing is planned right now (one tap on a length, for the goal with most of its week left).
// Never while a session runs (the session screen has it), at night, or on the sample day.

const MIN = 60_000;
/** A free stretch is worth offering only if this much of it is left before the next block. */
const MIN_FREE = 25 * MIN;

const hourInAthens = (ms: number) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", hourCycle: "h23" }).format(
      new Date(ms),
    ),
  );

export async function TodayFocusNow({ day, goals }: { day: DayView; goals: Goal[] }) {
  if (day.sample) return null;
  const now = Date.parse(day.now);
  const hour = hourInAthens(now);
  if (hour < 7 || hour >= 22) return null;
  const timeGoals = goals.filter((g) => g.active && goalKind(g) === "time");
  if (timeGoals.length === 0) return null;
  const active = await getFocusActive();
  if (!active || active.session) return null;

  const running = day.blocks.find(
    (b) =>
      b.goalId &&
      timeGoals.some((g) => g.id === b.goalId) &&
      Date.parse(b.start) <= now &&
      Date.parse(b.movedEnd ?? b.end) - now >= 5 * MIN,
  );
  if (running?.goalId) {
    const goal = timeGoals.find((g) => g.id === running.goalId) as Goal;
    const end = running.movedEnd ?? running.end;
    const left = (Date.parse(end) - now) / MIN;
    return (
      <TodayFocus
        goalId={goal.id}
        goalTitle={goal.title}
        eventId={running.id}
        until={end}
        line={`Your ${running.title} block runs until ${formatTime(end)}.`}
        lengths={LENGTHS.filter((m) => m < left)}
      />
    );
  }

  // Free now: no goal block runs, and the next one is at least 25 minutes away.
  const next = day.blocks.map((b) => Date.parse(b.start)).find((s) => s > now);
  if (next !== undefined && next - now < MIN_FREE) return null;
  const score = await getScore().catch(() => null);
  const left = (score?.goals ?? [])
    .filter((g) => g.scored && g.minutes_left > 0 && timeGoals.some((t) => t.id === g.goal_id))
    .sort((a, b) => b.minutes_left - a.minutes_left)[0];
  if (!left) return null;
  const free = next === undefined ? Number.POSITIVE_INFINITY : (next - now) / MIN;
  return (
    <TodayFocus
      goalId={left.goal_id}
      goalTitle={left.title}
      line={
        next === undefined
          ? "Nothing planned right now."
          : `Nothing planned until ${formatTime(new Date(next))}.`
      }
      lengths={LENGTHS.filter((m) => m <= free)}
    />
  );
}
