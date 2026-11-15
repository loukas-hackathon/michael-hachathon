import { voiceDuration } from "@michael/shared";
import type { GoalStatus } from "./goals-view";
import type { KeepWeek } from "./keep-day";
import { weekdayName } from "./keep-day";
import type { LostWeek } from "./lost-week";

// Today's lines from the person's own data (the founder: "based on the individual, so it doesn't
// get boring"). Every line names their goals, their numbers or their week, never what Michael or
// a feature does. Pure and deterministic: the same data says the same thing, and the line changes
// as their week does. Tested in today-lines.test.ts, including the voice rules.

/** A goal as these lines need it: its name and, when it has one, its weekly budget. */
export type GoalName = { title: string; budgetMinutes?: number | null; category?: string | null };

/** The time goal furthest behind its pace that still has time left this week, or null. */
export function furthestBehind(ranked: GoalStatus[]): GoalStatus | null {
  return ranked.find((r) => r.goal.budgetMinutes > 0 && r.leftMinutes > 0) ?? null;
}

/** Days left in the week, today included (Monday 7, Sunday 1). `day` is Monday first, 0 to 6. */
const daysLeft = (day: number) => 7 - Math.min(6, Math.max(0, day));

const names = (goals: GoalName[]) => goals.map((g) => g.title).filter(Boolean);

/** "Deep work", "Deep work and Training", "Deep work, Training and Sleep". */
export function listNames(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

/** Monday first, 0 to 6, from a date in the person's time zone (Athens for now). */
export function weekdayIndex(iso: string, timeZone = "Europe/Athens"): number {
  const name = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(new Date(iso));
  return Math.max(
    0,
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].indexOf(name),
  );
}

// ---------- the score area ----------

/** Today has no goal blocks: the run is safe, and the goal that most needs the time. */
export function noBlocksLine(top: GoalStatus | null): string {
  if (!top) return "No goal blocks today. It neither keeps nor breaks the run.";
  return `No goal blocks today, so the run is safe. ${top.goal.title} still has ${voiceDuration(top.leftMinutes)} to go this week.`;
}

/**
 * Under the week strip. A run: its length. No run: the days kept this week and the last of them,
 * or that today can be the first, so the same sentence never sits there all week.
 */
export function streakLine(week: KeepWeek): string {
  const rest = week.restDays.length
    ? ` ${week.restDays.join(" and ")} ${week.restDays.length === 1 ? "is your rest day" : "are your rest days"}.`
    : "";
  if (week.streak > 0) return `${week.streak} ${week.streak === 1 ? "day" : "days"} kept in a row.${rest}`;
  const todayAt = week.days.findIndex((d) => d.date === week.today);
  const kept = week.days.map((d, i) => ({ d, i })).filter(({ d, i }) => d.state === "kept" && i < todayAt);
  const last = kept.at(-1);
  const keepable = week.need != null && week.need > 0;
  if (last) {
    const n = kept.length;
    const head = `${n} ${n === 1 ? "day" : "days"} kept this week, the last on ${weekdayName(last.i)}.`;
    return `${head}${keepable ? " Today starts the next run." : ""}${rest}`;
  }
  if (todayAt === 0)
    return `${keepable ? "Keep today to start the week's run." : "A new week, no run yet."}${rest}`;
  return `No day kept yet this week.${keepable ? " Today can be the first." : ""}${rest}`;
}

// ---------- More from Michael ----------

/** The "Your week" row's preview: where the week stands for their goals, not what the page holds. */
export function weekRowPreview(ranked: GoalStatus[], day: number): string | null {
  const scored = ranked.filter((r) => r.goal.budgetMinutes > 0);
  if (scored.length === 0) return null;
  const left = daysLeft(day);
  const top = furthestBehind(scored);
  if (top?.behind) {
    const days = left === 1 ? "and today is the last day" : `${left} days left`;
    return `${top.goal.title} is furthest behind: ${voiceDuration(top.leftMinutes)} to go, ${days}.`;
  }
  const closed = scored.filter((r) => r.leftMinutes <= 0);
  if (closed.length === scored.length) return `All ${scored.length} goals closed for the week.`;
  if (top) return `Every goal on pace. ${top.goal.title} has ${voiceDuration(top.leftMinutes)} to go.`;
  return null;
}

/**
 * The Log time row's preview, naming one of their goals. The goal furthest behind when it can be
 * logged, else one picked by the day of the week, so the row reads differently through the week.
 */
export function logTimePreview(goals: { id: string; title: string }[], top: GoalStatus | null, day: number) {
  if (goals.length === 0) return "Did something for a goal without a block? Tell me how long.";
  const pick = goals.find((g) => g.id === top?.goal.id) ?? goals[day % goals.length];
  return `Did ${pick?.title} happen outside a block? Tell me how long.`;
}

/**
 * Michael's brief before the first one: what he will look at first, from today's data. The
 * biggest thing that took goal time this week, else today's blocks, else the goal furthest behind.
 */
export function noBriefLine({
  lost,
  blocksToday,
  top,
}: {
  lost: LostWeek | null;
  blocksToday: number;
  top: GoalStatus | null;
}): string {
  const cause = lost && lost.total > 0 ? lost.causes[0] : undefined;
  if (cause && cause.minutes > 0)
    return `None yet. I start with the ${voiceDuration(cause.minutes)} ${cause.what} took this week.`;
  if (blocksToday > 0)
    return `None yet. I start with your ${blocksToday === 1 ? "goal block" : `${blocksToday} goal blocks`} today.`;
  if (top) return `None yet. I start with ${top.goal.title}, furthest behind this week.`;
  return "None yet. One tap and I read your day.";
}

/** The Ask Claude card's first sentence: their biggest loss this week, or their week's number. */
export function askClaudeLine({
  connected,
  lost,
  weekPct,
}: {
  connected: boolean;
  lost: LostWeek | null;
  weekPct: number | null;
}): string | null {
  const cause = lost && lost.total > 0 ? lost.causes[0] : undefined;
  if (cause && cause.minutes > 0)
    return connected
      ? `${cause.what} took ${voiceDuration(cause.minutes)} of your goal blocks this week. Ask Claude why.`
      : `Want to know why ${cause.what} took ${voiceDuration(cause.minutes)} this week? Connect Claude.`;
  if (weekPct != null)
    return connected
      ? `${weekPct}% of your goal time this week. Ask Claude what moves it.`
      : `Want to know what moves your ${weekPct}%? Connect Claude.`;
  return null;
}

/**
 * Under "Your numbers": which of their own figures to look at first, against their usual. Null when
 * every figure is about usual (the tiles already say so).
 */
export function numbersLine(stats: { name: string; tone: "better" | "usual" | "worse" }[]): string | null {
  const worse = stats.filter((s) => s.tone === "worse");
  const better = stats.filter((s) => s.tone === "better");
  const first = worse[0];
  if (first && worse.length === 1)
    return `${first.name} is the one worse than your usual. Tap it for the fix.`;
  if (first) return `${worse.length} worse than your usual. Start with ${first.name}.`;
  if (better.length > 0)
    return `${better.length === 1 ? better[0]?.name : `${better.length} figures`} better than your usual, none worse.`;
  return null;
}

// ---------- a new account (Get started and the empty day) ----------

type SetupKey = "goals" | "calendar" | "watch" | "mac" | "iphone" | "nudges" | "claude";

const health = (g: GoalName) => g.category === "health" || g.category === "rest";
const sleepy = (g: GoalName) => /sleep|bed|rest/i.test(g.title);

/**
 * Why a Get started step matters to this person: their goals by name and budget, and the days
 * left in their week. Before any goal, the week itself. Never a description of the feature.
 */
export function setupWhy(key: SetupKey, goals: GoalName[], day: number): string {
  const titles = names(goals);
  const first = titles[0];
  const budget = goals.reduce((n, g) => n + (g.budgetMinutes ?? 0), 0);
  const left = daysLeft(day);
  const work = goals.find((g) => !health(g))?.title ?? first;
  switch (key) {
    case "goals":
      return left === 1
        ? "Last day of the week. Pick two or three goals and we start Monday clean."
        : `${left} days left this week. Pick two or three goals and I plan them in.`;
    case "calendar":
      if (!first) return "Your planned blocks are what I measure against.";
      return budget > 0
        ? `${voiceDuration(budget)} a week for ${listNames(titles.slice(0, 3))}. I measure it against the blocks in your calendar.`
        : `${listNames(titles.slice(0, 3))} get measured against the blocks in your calendar.`;
    case "watch": {
      const sleep = goals.find(sleepy);
      if (sleep) return `${sleep.title} is one of your goals. The watch tells me how the nights really go.`;
      if (work) return `How you slept decides how ${work} goes. The watch tells me which days to push.`;
      return "Sleep and workouts, so I know when to push and when to rest.";
    }
    case "mac":
      return work
        ? `Shows me where the hours meant for ${work} really go.`
        : "App time, so I can see where the hours went.";
    case "iphone":
      return work
        ? `Shows me what pulls you out of ${work}, as it happens.`
        : "Which apps you open, and for how long. Live.";
    case "nudges":
      return work
        ? `Up to five a day, when a ${work} block starts or slips.`
        : "Up to five a day, on your phone and watch.";
    case "claude":
      return work
        ? `Ask Claude how ${work} went this week, and let it book the next block.`
        : "Ask Claude about your day and let it plan with you.";
  }
}

/** The empty day once goals and the calendar are in: the goal that needs today most, by name. */
export function emptyDayLines(
  top: GoalStatus | null,
  day: number,
): { title: string; line: string; cta: string } {
  if (!top)
    return {
      title: "Nothing for your goals today yet.",
      line: "Say the word and I'll find a block and put it in your calendar.",
      cta: "Plan today with Michael",
    };
  const left = daysLeft(day);
  const days = left === 1 ? "and today is the last day" : `with ${left} days left`;
  return {
    title: `Nothing booked for ${top.goal.title} today.`,
    line: `${voiceDuration(top.leftMinutes)} of its ${voiceDuration(top.goal.budgetMinutes)} still to go ${days}. Say the word and I'll find a block.`,
    cta: `Plan ${top.goal.title} today`,
  };
}

/** The calendar card when it is not connected: what it costs their goals, by name. */
export function calendarMissingLine(goals: GoalName[]): string {
  const g = goals.find((x) => (x.budgetMinutes ?? 0) > 0 && !sleepy(x));
  if (!g?.budgetMinutes) return "Connect your calendar so I can plan your day.";
  return `${voiceDuration(g.budgetMinutes)} a week for ${g.title} is guesswork until I see your calendar.`;
}
