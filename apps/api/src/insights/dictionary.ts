import { type InsightSource, type InsightUnit, voiceDuration, voiceShortDuration } from "@michael/shared";
import { clockLabel, rate } from "../patterns/format";
import type { FeatureKey } from "./features";

// What every column of the daily table is, and how Michael talks about it. The words here are
// templates only: which relations hold, and every number in them, come from the miner.

export type Format = "min" | "score" | "pct" | "bpm" | "ms" | "count" | "clock" | "rating" | "flag";

/** Values the labels need that are worked out from the user's own nights. */
export interface Terms {
  /** The late cut off ("23:00"). */
  cutoff: string;
}

/** What a fix can be built on, when the app has a one tap action that fits. */
export type FixKind = "phone_down" | "book_training" | "protect_block";

export interface CauseDef {
  /** Which side of the threshold is the trigger. */
  side: "high" | "low";
  /** A fixed threshold. Without one the person's own median splits the days. */
  at?: number;
  /** The trigger in two or three words, for a title. */
  title: string;
  /** The days the trigger was there, plural, taking the threshold in words ("30 minutes or more"). */
  occasion: (amount: string, t: Terms) => string;
  /** The thing itself, for the plain fix ("Hold your phone after 23:00 under 30 minutes."). */
  noun?: (t: Terms) => string;
  /**
   * The fix when the trigger makes things worse, and when it makes them better. A function takes
   * the threshold as shown ("10:30").
   */
  avoid?: string | ((threshold: string) => string);
  keep?: string;
  fix?: FixKind;
}

export interface OutcomeDef {
  /** Which way is good for the user. */
  better: "high" | "low";
  /** After "gave": "a higher sleep score". */
  up: string;
  down: string;
  /** For a title: "higher sleep score". */
  titleUp: string;
  titleDown: string;
}

export interface FeatureDef {
  key: FeatureKey;
  label: (t: Terms) => string;
  format: Format;
  /** When in the day it is known: 0 the night, 1 the morning, 2 the day, 3 the evening. */
  phase: 0 | 1 | 2 | 3;
  /** Columns that describe the same thing: never compared with each other, and shown once. */
  family: string;
  sources: InsightSource[];
  cause?: CauseDef;
  outcome?: OutcomeDef;
}

const WATCH: InsightSource[] = ["apple-watch"];
const PHONE: InsightSource[] = ["iphone"];
const CALENDAR: InsightSource[] = ["google-calendar"];
const BLOCKS: InsightSource[] = ["google-calendar", "mac", "iphone"];

const outcome = (better: "high" | "low", up: string, down: string): OutcomeDef => ({
  better,
  up,
  down,
  titleUp: up.replace(/^(a|an|your) /, ""),
  titleDown: down.replace(/^(a|an|your) /, ""),
});

const MORNING_AFTER = "On mornings like that, move the hardest block to the afternoon.";

export const FEATURES: FeatureDef[] = [
  // ---------- the evening ----------
  {
    key: "late_phone_min",
    label: (t) => `Phone after ${t.cutoff}`,
    format: "min",
    phase: 3,
    family: "late",
    sources: PHONE,
    cause: {
      side: "high",
      at: 30,
      title: "Late phone",
      occasion: (a, t) => `nights with ${a} on your phone after ${t.cutoff}`,
      fix: "phone_down",
    },
  },
  {
    key: "late_screen_min",
    label: (t) => `Screens after ${t.cutoff}`,
    format: "min",
    phase: 3,
    family: "late",
    sources: ["iphone", "mac"],
    cause: {
      side: "high",
      at: 30,
      title: "Late screens",
      occasion: (a, t) => `nights with ${a} on screens after ${t.cutoff}`,
      fix: "phone_down",
    },
  },
  {
    key: "phone_before_sleep_min",
    label: () => "Phone in the hour before sleep",
    format: "min",
    phase: 3,
    family: "late",
    sources: ["iphone", "apple-watch"],
    cause: {
      side: "high",
      at: 20,
      title: "Phone before sleep",
      occasion: (a) => `nights with ${a} on your phone in the hour before sleep`,
      fix: "phone_down",
    },
  },
  {
    key: "bedtime_min",
    label: () => "Bedtime",
    format: "clock",
    phase: 3,
    // The start of the night's own record: never set against that night's length or score.
    family: "sleep",
    sources: WATCH,
    cause: {
      side: "high",
      title: "Late bedtime",
      occasion: (a) => `nights you went to bed ${a}`,
      fix: "phone_down",
    },
  },
  {
    key: "late_streak",
    label: () => "Second late night in a row",
    format: "flag",
    phase: 3,
    family: "late",
    sources: PHONE,
    cause: {
      side: "high",
      title: "Two late nights in a row",
      occasion: () => "second late nights in a row",
      avoid: "After one late night, make the next one an early one.",
      fix: "phone_down",
    },
  },
  // ---------- the night, on the morning it ends ----------
  {
    key: "sleep_min",
    label: () => "Sleep",
    format: "min",
    phase: 0,
    family: "sleep",
    sources: WATCH,
    cause: {
      side: "low",
      title: "Short sleep",
      occasion: (a) => `nights with ${a} of sleep`,
      avoid: MORNING_AFTER,
    },
    outcome: outcome("high", "more sleep", "less sleep"),
  },
  {
    key: "sleep_score",
    label: () => "Sleep score",
    format: "score",
    phase: 0,
    family: "sleep",
    sources: WATCH,
    cause: {
      side: "low",
      title: "Low sleep score",
      occasion: (a) => `nights with a sleep score ${a}`,
      avoid: MORNING_AFTER,
    },
    outcome: outcome("high", "a higher sleep score", "a lower sleep score"),
  },
  {
    key: "deep_min",
    label: () => "Deep sleep",
    format: "min",
    phase: 0,
    family: "sleep",
    sources: WATCH,
    outcome: outcome("high", "more deep sleep", "less deep sleep"),
  },
  {
    key: "rem_min",
    label: () => "REM sleep",
    format: "min",
    phase: 0,
    family: "sleep",
    sources: WATCH,
    outcome: outcome("high", "more REM sleep", "less REM sleep"),
  },
  {
    key: "short_night",
    label: () => "Night under 6 hours",
    format: "flag",
    phase: 0,
    family: "sleep",
    sources: WATCH,
    cause: {
      side: "high",
      title: "Short night",
      occasion: () => "nights under 6 hours",
      avoid: MORNING_AFTER,
    },
  },
  // ---------- the morning's readings ----------
  {
    key: "hrv",
    label: () => "Heart rate variability",
    format: "ms",
    phase: 1,
    family: "body",
    sources: WATCH,
    cause: {
      side: "low",
      title: "Low heart rate variability",
      occasion: (a) => `mornings with heart rate variability ${a}`,
      avoid: "On mornings like that, keep the first block short and the day light.",
    },
    outcome: outcome("high", "higher heart rate variability", "lower heart rate variability"),
  },
  {
    key: "resting_hr",
    label: () => "Resting heart rate",
    format: "bpm",
    phase: 1,
    family: "body",
    sources: WATCH,
    outcome: outcome("low", "a higher resting heart rate", "a lower resting heart rate"),
  },
  {
    key: "recovery",
    label: () => "Recovery",
    format: "pct",
    phase: 1,
    family: "body",
    sources: WATCH,
    cause: {
      side: "low",
      title: "Low recovery",
      occasion: (a) => `mornings with recovery ${a}`,
      avoid: "On mornings like that, keep the first block short and the day light.",
    },
    outcome: outcome("high", "higher recovery", "lower recovery"),
  },
  // ---------- the day ----------
  {
    key: "phone_opens",
    label: () => "Phone opened",
    format: "count",
    phase: 2,
    family: "phone",
    sources: PHONE,
    cause: {
      side: "high",
      title: "Phone opened often",
      occasion: (a) => `days your phone opened ${a} times`,
      avoid: "Phone in another room for the first block.",
    },
    outcome: outcome("low", "more phone opens", "fewer phone opens"),
  },
  {
    key: "phone_min",
    label: () => "Phone time",
    format: "min",
    phase: 2,
    family: "phone",
    sources: PHONE,
    cause: {
      side: "high",
      title: "Heavy phone day",
      occasion: (a) => `days with ${a} on your phone`,
      avoid: "Phone in another room for the first block.",
    },
  },
  {
    key: "workout_min",
    label: () => "Training",
    format: "min",
    phase: 2,
    family: "training",
    sources: WATCH,
  },
  {
    key: "trained",
    label: () => "Training",
    format: "flag",
    phase: 2,
    family: "training",
    sources: WATCH,
    cause: {
      side: "high",
      title: "Training day",
      occasion: () => "days you trained",
      avoid: "Keep the session, and keep the evening after it clear.",
      keep: "Keep training on the plan.",
      fix: "book_training",
    },
  },
  {
    key: "evening_workout",
    label: () => "Training after 19:00",
    format: "flag",
    phase: 3,
    family: "training",
    sources: WATCH,
    cause: {
      side: "high",
      title: "Evening training",
      occasion: () => "days you trained after 19:00",
      avoid: "Train before 19:00.",
      keep: "Keep the evening session.",
    },
  },
  {
    key: "after_training",
    label: () => "Day after training",
    format: "flag",
    phase: 0,
    family: "training",
    sources: WATCH,
    cause: {
      side: "high",
      title: "Day after training",
      occasion: () => "days after training",
      avoid: "Plan a lighter day after a session.",
      keep: "Put the hardest work on the day after a session.",
    },
  },
  {
    key: "meeting_min",
    label: () => "Meetings",
    format: "min",
    phase: 2,
    family: "meetings",
    sources: CALENDAR,
    cause: {
      side: "high",
      title: "Heavy meeting day",
      occasion: (a) => `days with ${a} of meetings`,
      noun: () => "meetings",
      fix: "protect_block",
    },
  },
  {
    key: "meeting_count",
    label: () => "Meetings",
    format: "count",
    phase: 2,
    family: "meetings",
    sources: CALENDAR,
    cause: {
      side: "high",
      title: "Many meetings",
      occasion: (a) => `days with ${a} meetings`,
      noun: () => "meetings",
      fix: "protect_block",
    },
  },
  {
    key: "heavy_meeting_day",
    label: () => "3 or more meetings",
    format: "flag",
    phase: 2,
    family: "meetings",
    sources: CALENDAR,
    cause: {
      side: "high",
      title: "Three meetings or more",
      occasion: () => "days with 3 or more meetings",
      avoid: "Cap the day at two meetings when a hard block is on it.",
      fix: "protect_block",
    },
  },
  {
    key: "first_block_start_min",
    label: () => "First block starts",
    format: "clock",
    phase: 2,
    family: "plan",
    sources: CALENDAR,
    cause: {
      side: "high",
      title: "Late first block",
      occasion: (a) => `days your first block started ${a}`,
      avoid: (t) => `Start the first block before ${t}.`,
      keep: "Keep the later start for the first block.",
    },
  },
  {
    key: "planned_min",
    label: () => "Planned goal time",
    format: "min",
    phase: 2,
    family: "plan",
    sources: CALENDAR,
  },
  {
    key: "spent_min",
    label: () => "Goal time spent",
    format: "min",
    phase: 2,
    family: "focus",
    sources: BLOCKS,
  },
  {
    key: "lost_min",
    label: () => "Lost in goal blocks",
    format: "min",
    phase: 2,
    family: "focus",
    sources: BLOCKS,
    outcome: outcome("low", "more time lost in your goal blocks", "less time lost in your goal blocks"),
  },
  {
    key: "first_block_lost_min",
    label: () => "Lost in the first block",
    format: "min",
    phase: 2,
    family: "focus",
    sources: BLOCKS,
    outcome: {
      better: "low",
      up: "more time lost in your first block",
      down: "less time lost in your first block",
      titleUp: "slower first block",
      titleDown: "cleaner first block",
    },
  },
  {
    key: "focus_pct",
    label: () => "Goal time held",
    format: "pct",
    phase: 2,
    family: "focus",
    sources: BLOCKS,
    outcome: outcome("high", "more of your goal time held", "less of your goal time held"),
  },
  {
    key: "switches_per_hour",
    label: () => "App switches an hour",
    format: "count",
    phase: 2,
    family: "switching",
    sources: ["mac", "iphone"],
    outcome: outcome("low", "more app switching", "less app switching"),
  },
  {
    key: "ai_min",
    label: () => "AI tools open",
    format: "min",
    phase: 2,
    family: "ai",
    sources: ["claude"],
    cause: {
      side: "high",
      title: "Long AI sessions",
      occasion: (a) => `days with ${a} in AI tools`,
      noun: () => "AI tools",
    },
  },
  {
    key: "last_meal_min",
    label: () => "Last meal",
    format: "clock",
    phase: 2,
    family: "meals",
    sources: [],
    cause: {
      side: "high",
      title: "Late last meal",
      occasion: (a) => `days your last meal was ${a}`,
      avoid: (t) => `Last meal before ${t}.`,
      keep: "Keep the later last meal.",
    },
  },
  {
    key: "caffeine_last_min",
    label: () => "Last coffee",
    format: "clock",
    phase: 2,
    family: "meals",
    sources: [],
    cause: {
      side: "high",
      at: 15 * 60,
      title: "Late coffee",
      occasion: (a) => `days with coffee ${a}`,
      avoid: "Last coffee before 15:00.",
    },
  },
  {
    key: "training_rating",
    label: () => "Training, your rating",
    format: "rating",
    phase: 2,
    family: "training_rating",
    sources: [],
    outcome: outcome("high", "a better session by your own rating", "a worse session by your own rating"),
  },
  {
    key: "meeting_rating",
    label: () => "Meetings, your rating",
    format: "rating",
    phase: 2,
    family: "meeting_rating",
    sources: [],
    outcome: outcome("high", "better meetings by your own rating", "worse meetings by your own rating"),
  },
];

const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));
export const featureDef = (key: FeatureKey): FeatureDef => {
  const def = BY_KEY.get(key);
  if (!def) throw new RangeError(`Unknown feature ${key}`);
  return def;
};

export const unitOf = (format: Format): InsightUnit | undefined =>
  format === "clock" || format === "flag" ? undefined : format === "rating" ? "score" : format;

const one = (n: number) => String(Math.round(n * 10) / 10);

/** A figure in a step: "41 min", "64", "38%", "46 ms", "00:40". */
export function shown(format: Format, n: number): string {
  switch (format) {
    case "min":
      return voiceShortDuration(n);
    case "score":
      return String(Math.round(n));
    case "pct":
      return `${Math.round(n)}%`;
    case "bpm":
      return `${Math.round(n)} bpm`;
    case "ms":
      return `${Math.round(n)} ms`;
    case "clock":
      return clockLabel(n);
    case "rating":
      return one(n);
    default:
      return rate(n);
  }
}

/** The figure as a number in the step's unit, rounded the way it is shown. */
export const rounded = (format: Format, n: number): number =>
  format === "rating" || (format === "count" && Math.abs(n) < 10) ? Math.round(n * 10) / 10 : Math.round(n);

/** A threshold in a sentence: "30 minutes or more", "more than 12 minutes", "under 70", "after 00:10". */
export function amount(format: Format, side: "high" | "low", threshold: number, inclusive: boolean): string {
  if (format === "clock") return `${side === "high" ? "after" : "before"} ${clockLabel(threshold)}`;
  if (format === "min" || format === "count") {
    const t = format === "min" ? voiceDuration(threshold) : rate(threshold);
    if (side === "low") return `under ${t}`;
    return inclusive ? `${t} or more` : `more than ${t}`;
  }
  const t = shown(format, threshold);
  if (side === "low") return `under ${t}`;
  return inclusive ? `of ${t} or more` : `above ${t}`;
}
