import { type Event, type Goal, isNap, isSleepGoal, type ScoreSleep } from "@michael/shared";
import { DAY, HOUR, MINUTE, type Zone } from "../patterns/time";
import { overlapWith, type Span, union } from "../patterns/util";

// The week around the score (#117, #165): the waking day, the fixed calendar commitments, the
// free time left and sleep per night. Pure, like the score.
//
//   Waking day   From the sleep goal: it ends at `screens_off` (default 23:00) and starts
//                `sleep_hours` later. Without a sleep goal with hours: 07:00 to 23:00, the same
//                day the analysis brief uses for "time still free this week".
//   Committed    Calendar events that are not goal blocks (meetings, errands, anything with
//                other people), inside the waking day. All day entries are left out: a holiday
//                marker would otherwise fill the week.
//   Free left    The waking day from `now` to the end of the week, minus what is committed. Goal
//                blocks count as free: they are where goal time goes.
//   Sleep        Minutes slept in the night that ended on each day (the same rule the Morning and
//                Evening moments use), against the goal's nightly minutes.

export interface WakingDay {
  /** Minutes after local midnight the waking day starts. */
  startMin: number;
  /** Minutes after local midnight it ends; may pass 1440 (00:30 is 1470). */
  endMin: number;
}

const DEFAULT_WAKING: WakingDay = { startMin: 7 * 60, endMin: 23 * 60 };

const clockMinutes = (v: unknown): number | null => {
  if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return null;
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** The active sleep goal, if any. */
export const sleepGoalOf = (goals: Goal[]): Goal | null =>
  goals.find((g) => g.active && isSleepGoal(g)) ?? null;

/** The nightly sleep goal in minutes: `sleep_hours`, else the weekly budget over 7. */
export function sleepGoalMinutes(goal: Goal | null): number | null {
  if (!goal) return null;
  const hours = goal.target?.sleep_hours;
  if (typeof hours === "number" && hours > 0 && hours <= 24) return Math.round(hours * 60);
  if (goal.weekly_budget_minutes) return Math.round(goal.weekly_budget_minutes / 7);
  return null;
}

export function wakingDay(goals: Goal[]): WakingDay {
  const goal = sleepGoalOf(goals);
  const sleep = sleepGoalMinutes(goal);
  if (!goal || !sleep) return DEFAULT_WAKING;
  const off = clockMinutes(goal.target?.screens_off) ?? DEFAULT_WAKING.endMin;
  // A bedtime in the small hours belongs to the evening before.
  const endMin = off < 12 * 60 ? off + 1440 : off;
  const startMin = Math.max(0, endMin + sleep - 1440);
  return { startMin, endMin: Math.max(startMin, endMin) };
}

/** The waking span of a local day. */
export const wakingSpan = (zone: Zone, day: string, w: WakingDay): Span => ({
  start: zone.at(day, w.startMin),
  end: zone.at(day, w.endMin),
});

/** Fixed commitments: calendar events that are not goal blocks, all day entries left out. */
export function commitments(events: Event[], blockEventIds: ReadonlySet<string>): Span[] {
  const spans: Span[] = [];
  for (const e of events) {
    if (e.type !== "calendar_event" || !e.end_at || blockEventIds.has(e.id)) continue;
    if (e.data?.all_day === true) continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    if (!(end > start) || end - start >= DAY) continue;
    spans.push({ start, end });
  }
  return union(spans);
}

/** Committed minutes inside the waking days of `days`. */
export function committedMinutes(zone: Zone, days: string[], w: WakingDay, committed: Span[]): number {
  let ms = 0;
  for (const day of days) ms += overlapWith(wakingSpan(zone, day, w), committed);
  return Math.round(ms / MINUTE);
}

/** Waking time from `now` to the end of `days`, minus what is committed. */
export function freeMinutesLeft(
  zone: Zone,
  days: string[],
  now: number,
  w: WakingDay,
  committed: Span[],
): number {
  let ms = 0;
  for (const day of days) {
    const waking = wakingSpan(zone, day, w);
    const span = { start: Math.max(waking.start, now), end: waking.end };
    if (span.end > span.start) ms += span.end - span.start - overlapWith(span, committed);
  }
  return Math.max(0, Math.round(ms / MINUTE));
}

/**
 * Sleep per night this week, or null until there is a sleep goal and sleep data. A night counts on
 * the day it ended (the day you woke up); naps (packages/shared/src/sleep.ts) never count.
 */
export function sleepWeek(
  events: Event[],
  goals: Goal[],
  zone: Zone,
  days: string[],
  now: number,
): ScoreSleep | null {
  const goalMinutes = sleepGoalMinutes(sleepGoalOf(goals));
  if (goalMinutes == null) return null;
  const byDay = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "sleep" || !e.end_at) continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    if (!(end > start) || end - start > DAY || end > now) continue;
    if (isNap(start, end, (start - zone.startOfDay(zone.dayOf(start))) / HOUR)) continue;
    const day = zone.dayOf(end);
    const recorded = e.data?.duration_min;
    const minutes = typeof recorded === "number" && recorded > 0 ? recorded : (end - start) / MINUTE;
    byDay.set(day, (byDay.get(day) ?? 0) + minutes);
  }
  const nightly = days.map((d) => {
    const m = byDay.get(d);
    return m === undefined ? null : Math.round(m);
  });
  if (nightly.every((n) => n === null)) return null;
  return { goal_minutes: goalMinutes, nightly };
}
