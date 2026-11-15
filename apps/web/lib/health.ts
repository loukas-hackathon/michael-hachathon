// Types only from @michael/shared: this file reaches the Timeline's client code, and a value import
// would ship zod and the whole schema file with it (#255). Goal helpers live in ./sleep-goal.ts.
// The nap rule comes from "@michael/shared/sleep", a zod free entry the API score uses too.
import type { Event } from "@michael/shared";
import { isNap as napRule } from "@michael/shared/sleep";
import { hm } from "./format";

// The Apple Watch on one day, from the events Health Auto Export writes (apps/api/src/ingest/
// health-auto-export.ts, and the demo week in the same shapes): the night you woke up from, the
// night you went to bed from, naps, the workouts, and heart rate per hour. Pure, so Timeline and
// Today read the watch the same way.
//
// The night rule, one rule for every screen:
// - A sleep shorter than 3 hours that starts between 09:00 and 20:00 is a nap: a small quiet block
//   in the day, never a night and never set against the Sleep goal (packages/shared/src/sleep.ts;
//   the API score leaves naps out by the same rule).
// - Every other sleep is a night, and a night belongs to the day you woke up. It is that day's
//   `lastNight` (the band above the day, and Today's watch line) wherever the bedtime falls, so a
//   night from 00:40 to 07:20 is the 07:20 day's, the same day the API's score counts it on.
// - The same night also closes the day you went to bed from, as a faint `tonight` band below it,
//   even when the bedtime is after 00:00 of the next calendar day: any bedtime from 12:00 of the
//   day to 06:00 the next morning counts. Callers pass the next morning's sleep events for that.
// When two sleeps qualify, the longer wins.

export type SleepStages = { deep?: number; core?: number; rem?: number; awake?: number };

export type Night = {
  start: number;
  end: number;
  /** Minutes asleep (awake time left out), as the watch reports it. */
  minutes: number;
  /** Minutes per stage, when the watch reports stages. */
  stages?: SleepStages;
  /** Resting heart rate (bpm) and HRV (ms) read around the night, when the watch sent them. */
  restingHr?: number;
  hrv?: number;
};

/** A daytime sleep under 3 hours (the night rule above). */
export type Nap = { start: number; end: number; minutes: number };

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
  naps: Nap[];
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
  if (!(end > start) || end - start > 24 * HOUR) return null;
  const minutes = num(e.data.duration_min) ?? (end - start) / 60_000;
  const stages: SleepStages = {
    deep: num(e.data.deep_min),
    core: num(e.data.core_min),
    rem: num(e.data.rem_min),
    awake: num(e.data.awake_min),
  };
  const staged = [stages.deep, stages.core, stages.rem].some((v) => v !== undefined && v > 0);
  return staged ? { start, end, minutes, stages } : { start, end, minutes };
}

/** Whether a sleep that starts on the day beginning at `dayStart` is a nap (the night rule). */
function isNap(n: Night, dayStart: number) {
  return napRule(n.start, n.end, (n.start - dayStart) / HOUR);
}

/** The average of one biometric's hourly readings that start in [from, to), or undefined. */
function averageOf(events: Event[], metric: string, from: number, to: number) {
  const values = events
    .filter((e) => e.type === "biometric" && e.data.metric === metric)
    .filter((e) => t(e.start_at) >= from && t(e.start_at) < to)
    .map((e) => num(e.data.avg))
    .filter((v): v is number => v !== undefined);
  return values.length ? Math.round(values.reduce((a, v) => a + v, 0) / values.length) : undefined;
}

/**
 * The night with its resting heart rate and HRV. The watch writes HRV during the night and resting
 * heart rate about once a day (often stamped 00:00), so readings up to 2 hours either side count.
 */
function withHeart(n: Night, events: Event[]): Night {
  const from = n.start - 2 * HOUR;
  const to = n.end + 2 * HOUR;
  const restingHr = averageOf(events, "resting_heart_rate", from, to);
  const hrv = averageOf(events, "heart_rate_variability", from, to);
  return {
    ...n,
    ...(restingHr !== undefined ? { restingHr } : {}),
    ...(hrv !== undefined ? { hrv } : {}),
  };
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

/**
 * The watch on the day [dayStart, dayEnd). Events may come from a wider range (the next morning's
 * sleep and biometrics, for a bedtime after midnight); they are filtered here.
 */
export function healthOf(events: Event[], dayStart: number, dayEnd: number): DayHealth {
  const sleeps = new Map<string, Night>();
  for (const e of events) {
    if (e.type !== "sleep") continue;
    const n = night(e);
    // The same sleep can arrive twice when the caller merges two ranges.
    if (n) sleeps.set(`${n.start}-${n.end}`, n);
  }
  const naps: Nap[] = [];
  const nights: Night[] = [];
  for (const n of sleeps.values()) {
    if (isNap(n, dayStart)) {
      naps.push({ start: n.start, end: n.end, minutes: n.minutes });
    } else if (!isNap(n, dayEnd)) {
      // A nap on the next day is never this day's night.
      nights.push(n);
    }
  }
  naps.sort((a, b) => a.start - b.start);
  const longest = (list: Night[]) => {
    const best = list.reduce<Night | null>((b, n) => (!b || n.minutes > b.minutes ? n : b), null);
    return best ? withHeart(best, events) : null;
  };
  // The night rule (top of this file): woke up on this day, or went to bed from it (12:00 to 06:00).
  const lastNight = longest(nights.filter((n) => n.end > dayStart && n.end <= dayEnd));
  const tonight = longest(
    nights.filter((n) => n.end > dayEnd && n.start >= dayStart + 12 * HOUR && n.start < dayEnd + 6 * HOUR),
  );

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

  return { lastNight, tonight, naps, workouts, heart };
}

/** "1h 18 short of your goal", "on your goal", "35 min over your goal"; null without a goal. */
export function sleepAgainstGoal(minutes: number, goal: number | null): string | null {
  if (!goal) return null;
  const diff = Math.round(minutes - goal);
  if (Math.abs(diff) < 10) return "on your goal";
  return diff < 0 ? `${hm(-diff)} short of your goal` : `${hm(diff)} over your goal`;
}

/**
 * The stages in the order the bar draws them, Apple's order (awake, REM, core, deep), leaving out
 * what the watch did not report. Awake comes first so the asleep stages run together after it.
 */
export function stageParts(s: SleepStages): { key: keyof SleepStages; name: string; minutes: number }[] {
  const names: [keyof SleepStages, string][] = [
    ["awake", "Awake"],
    ["rem", "REM"],
    ["core", "Core"],
    ["deep", "Deep"],
  ];
  return names
    .map(([key, name]) => ({ key, name, minutes: Math.round(s[key] ?? 0) }))
    .filter((p) => p.minutes > 0);
}

/** "Swim 1h 16 · 2.4 km · 132 bpm avg" style parts, for a block or a line. */
export function workoutParts(w: Workout): string[] {
  return [hm(w.minutes), w.distance, w.avgHr ? `${Math.round(w.avgHr)} bpm average` : undefined].filter(
    (p): p is string => Boolean(p),
  );
}
