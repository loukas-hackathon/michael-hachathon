import { type Event, type Goal, isSleepGoal } from "@michael/shared";
import { hm } from "./format";

// The Apple Watch on one day, from the events Health Auto Export writes (apps/api/src/ingest/
// health-auto-export.ts, and the demo week in the same shapes): the night that ended in the morning,
// the night that starts in the evening, the workouts, and heart rate per hour. Pure, so Timeline
// and Today read the watch the same way.

export type Night = {
  start: number;
  end: number;
  /** Minutes asleep (awake time left out), as the watch reports it. */
  minutes: number;
};

export type Workout = {
  start: number;
  end: number;
  name: string;
  minutes: number;
  avgHr?: number;
  kcal?: number;
  distance?: string;
};

/** One hour of heart rate: `at` is the middle of the hour. */
export type HeartPoint = { at: number; avg: number; min: number; max: number };

export type DayHealth = {
  lastNight: Night | null;
  tonight: Night | null;
  workouts: Workout[];
  heart: HeartPoint[];
};

/** The cookie that remembers whether the viewer hid the heart rate lane on Timeline ("off"). */
export const HEART_COOKIE = "m_hr";

const HOUR = 3_600_000;
const t = (iso: string) => new Date(iso).getTime();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// Apple's workout names, shortened for a block label. Anything else is shown as Apple names it.
const SHORT: Record<string, string> = {
  "Traditional Strength Training": "Strength training",
  "Functional Strength Training": "Strength training",
  "High Intensity Interval Training": "HIIT",
  "Pool Swim": "Swim",
  "Open Water Swim": "Open water swim",
  "Outdoor Run": "Run",
  "Indoor Run": "Treadmill run",
  "Outdoor Cycle": "Ride",
  "Indoor Cycle": "Indoor ride",
  "Outdoor Walk": "Walk",
};

function night(e: Event): Night | null {
  if (!e.end_at) return null;
  const start = t(e.start_at);
  const end = t(e.end_at);
  if (!(end > start)) return null;
  const minutes = num(e.data.duration_min) ?? (end - start) / 60_000;
  return { start, end, minutes };
}

function workout(e: Event): Workout | null {
  if (!e.end_at) return null;
  const start = t(e.start_at);
  const end = t(e.end_at);
  if (!(end > start)) return null;
  // The title is "Pool Swim 1h16m, 2.4 km"; data.name is the bare name.
  const raw =
    typeof e.data.name === "string" && e.data.name ? e.data.name : e.title.split(/ \d/)[0] || "Workout";
  const km = num(e.data.distance);
  const units = typeof e.data.distance_units === "string" ? e.data.distance_units : "km";
  return {
    start,
    end,
    name: SHORT[raw] ?? raw,
    minutes: num(e.data.duration_min) ?? (end - start) / 60_000,
    avgHr: num(e.data.avg_hr),
    kcal: num(e.data.active_kcal),
    distance: km ? `${Math.round(km * 10) / 10} ${units}` : undefined,
  };
}

/** The watch on the day [dayStart, dayEnd). Events may come from a wider range; they are filtered here. */
export function healthOf(events: Event[], dayStart: number, dayEnd: number): DayHealth {
  const nights = events
    .filter((e) => e.type === "sleep")
    .map(night)
    .filter((n): n is Night => n !== null);
  const longest = (list: Night[]) =>
    list.reduce<Night | null>((best, n) => (!best || n.minutes > best.minutes ? n : best), null);
  // Last night ended in the morning (before 14:00); tonight starts in the evening (from 18:00).
  // Naps in between are left out of both.
  const lastNight = longest(nights.filter((n) => n.end > dayStart && n.end <= dayStart + 14 * HOUR));
  const tonight = longest(nights.filter((n) => n.start >= dayStart + 18 * HOUR && n.start < dayEnd));

  const workouts = events
    .filter((e) => e.type === "workout")
    .map(workout)
    .filter((w): w is Workout => w !== null && w.end > dayStart && w.start < dayEnd)
    .sort((a, b) => a.start - b.start);

  const hours = new Map<number, HeartPoint>();
  for (const e of events) {
    if (e.type !== "biometric" || e.data.metric !== "heart_rate") continue;
    const start = t(e.start_at);
    const avg = num(e.data.avg);
    if (avg === undefined || start < dayStart || start >= dayEnd) continue;
    hours.set(start, {
      at: start + HOUR / 2,
      avg,
      min: num(e.data.min) ?? avg,
      max: num(e.data.max) ?? avg,
    });
  }
  const heart = [...hours.values()].sort((a, b) => a.at - b.at);

  return { lastNight, tonight, workouts, heart };
}

/** Minutes a night the sleep goal asks for: `sleep_hours`, else its weekly budget over 7. */
export function sleepGoalMinutes(goals: Goal[]): number | null {
  const goal = goals.find((g) => g.active && isSleepGoal(g));
  if (!goal) return null;
  const hours = num(goal.target?.sleep_hours);
  if (hours) return Math.round(hours * 60);
  return goal.weekly_budget_minutes ? Math.round(goal.weekly_budget_minutes / 7) : null;
}

/** "1h 18 short of your goal", "on your goal", "35 min over your goal"; null without a goal. */
export function sleepAgainstGoal(minutes: number, goal: number | null): string | null {
  if (!goal) return null;
  const diff = Math.round(minutes - goal);
  if (Math.abs(diff) < 10) return "on your goal";
  return diff < 0 ? `${hm(-diff)} short of your goal` : `${hm(diff)} over your goal`;
}

/** "Swim 1h 16 · 2.4 km · 132 bpm avg" style parts, for a block or a line. */
export function workoutParts(w: Workout): string[] {
  return [hm(w.minutes), w.distance, w.avgHr ? `${Math.round(w.avgHr)} bpm average` : undefined].filter(
    (p): p is string => Boolean(p),
  );
}
