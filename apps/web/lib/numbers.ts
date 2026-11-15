// Your numbers (Today and /numbers/[key]): each figure Michael reads every day, set against the
// user's own usual, with its trend and one fix. Built from GET /v1/insights: its 12 week series for
// the figures and its patterns for the fix, so a fix shown with proof is one Michael found in the data.

import { addDays, athensDay } from "./athens";
import type { Insight, Series } from "./insights";

export type NumberKey = Series["key"];

interface NumberDef {
  key: NumberKey;
  /** Which way is good for the user. */
  better: "high" | "low";
  /** Inside this distance from the usual it reads "about your usual". */
  near: number;
  /** One sentence for anyone: what the number is and where it comes from. (Brand) */
  what: string;
  /** The fix when no pattern backs one yet. Said as advice, never as proof. (Brand) */
  fallback: string;
}

/** Today's order: the time first (what Michael is for), then the night that shapes it. */
export const NUMBERS: NumberDef[] = [
  {
    key: "lost_min",
    better: "low",
    near: 5,
    what: "Minutes of your goal blocks that went to something else, read from your Mac and iPhone.",
    fallback: "Mute the app that took it while a goal block runs.",
  },
  {
    key: "late_phone_min",
    better: "low",
    near: 5,
    what: "Minutes on your phone late in the evening, read from Screen Time on your iPhone.",
    fallback: "Phone down at 22:30.",
  },
  {
    key: "sleep_score",
    better: "high",
    near: 3,
    what: "Your Watch's score for the night: how long, how steady and how fast you fell asleep.",
    fallback: "Same bedtime every night this week, weekend included.",
  },
  {
    key: "recovery",
    better: "high",
    near: 5,
    what: "How ready your body is this morning, from your heart overnight. Read from your Watch.",
    fallback: "On a low morning, move the hardest block to the afternoon.",
  },
  {
    key: "hrv",
    better: "high",
    near: 3,
    what: "Heart rate variability overnight, from your Watch. Higher means better recovered.",
    fallback: "Keep hard training before 19:00.",
  },
  {
    key: "resting_hr",
    better: "low",
    near: 2,
    what: "Your lowest steady heart rate overnight, from your Watch. Lower means better recovered.",
    fallback: "An easy day after two hard ones.",
  },
];

export const numberDef = (key: string) => NUMBERS.find((d) => d.key === key);

/** Figures measured overnight: their day is the morning the night ends. */
const NIGHT: NumberKey[] = ["sleep_score", "recovery", "hrv", "resting_hr"];

const UNIT: Record<string, string> = { score: "", pct: "%", ms: " ms", bpm: " bpm", min: " min", count: "" };
/** For a difference: a recovery 9 above is 9 points, not 9 per cent of something. */
const DIFF_UNIT: Record<string, string> = {
  score: "",
  pct: " points",
  ms: " ms",
  bpm: " bpm",
  min: " min",
  count: "",
};

export const unitOf = (s: Series) => UNIT[s.unit] ?? "";

type Reading = { day: string; value: number };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const readings = (s: Series): Reading[] =>
  s.points.filter((p): p is Reading => p.value != null).map((p) => ({ day: p.day, value: p.value }));

export type Tone = "better" | "worse" | "usual";

export interface NumberStat {
  def: NumberDef;
  series: Series;
  last: Reading;
  /** Mean of the 28 readings before the last one. */
  usual: number;
  tone: Tone;
  /** "4 below your usual 80", "about your usual 13 min". */
  compare: string;
  /** "Last night", "Today", "Yesterday", "Wed 11 Nov". */
  when: string;
  /** Means of the last 7 days and the 7 before, and the best reading in the series. */
  week: number | null;
  weekBefore: number | null;
  best: number;
}

function dayWord(day: string, key: NumberKey, today: string) {
  if (day === today) return NIGHT.includes(key) ? "Last night" : "Today";
  // A night dated yesterday ended yesterday morning: its date says it plainer than any phrase.
  if (day === addDays(today, -1) && !NIGHT.includes(key)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** One figure against the user's own usual. Null under 2 readings: nothing to compare yet. */
export function numberStat(s: Series, today = athensDay()): NumberStat | null {
  const def = numberDef(s.key);
  const read = readings(s);
  const last = read[read.length - 1];
  if (!def || !last || read.length < 2) return null;
  const usual = Math.round(mean(read.slice(-29, -1).map((r) => r.value)));
  const diff = Math.round(last.value - usual);
  const tone: Tone =
    Math.abs(diff) <= def.near ? "usual" : diff > 0 === (def.better === "high") ? "better" : "worse";
  const u = unitOf(s);
  const compare =
    tone === "usual"
      ? `about your usual ${usual}${u}`
      : `${Math.abs(diff)}${DIFF_UNIT[s.unit] ?? ""} ${diff > 0 ? "above" : "below"} your usual ${usual}${u}`;
  const lastDay = s.points[s.points.length - 1]?.day ?? last.day;
  const inDays = (from: string, to: string) =>
    read.filter((r) => r.day > from && r.day <= to).map((r) => r.value);
  const w = inDays(addDays(lastDay, -7), lastDay);
  const wb = inDays(addDays(lastDay, -14), addDays(lastDay, -7));
  const values = read.map((r) => r.value);
  return {
    def,
    series: s,
    last,
    usual,
    tone,
    compare,
    when: dayWord(last.day, s.key, today),
    week: w.length ? Math.round(mean(w)) : null,
    weekBefore: wb.length ? Math.round(mean(wb)) : null,
    best: def.better === "high" ? Math.max(...values) : Math.min(...values),
  };
}

/** Today's numbers in their order, each with at least 2 readings. */
export function numberStats(series: Series[], today = athensDay()): NumberStat[] {
  return NUMBERS.map((d) => series.find((s) => s.key === d.key))
    .map((s) => (s ? numberStat(s, today) : null))
    .filter((x): x is NumberStat => x !== null);
}

/** The keys an insight is about, from its id ("chain:late_phone_min>sleep_score>..."). */
export const insightKeys = (i: Insight) => i.id.split(/[:>]/).slice(1);

/** The patterns that involve a number, strongest first (the list arrives sorted). */
export const patternsFor = (key: NumberKey, patterns: Insight[]) =>
  patterns.filter((i) => insightKeys(i).includes(key));

/** The first sentence of a fix, for a one line row: "Phone down at 22:30." */
export const firstSentence = (text: string) => /^.*?[.?](?=\s|$)/.exec(text.trim())?.[0] ?? text.trim();

/**
 * A trailing 7 day mean: each day the mean of the readings in it and the 6 days before, kept only
 * when at least 4 of the 7 have one, so a week without the watch stays a gap.
 */
export function weekly(s: Series): Series {
  const points = s.points.map((p, i) => {
    const window = s.points
      .slice(Math.max(0, i - 6), i + 1)
      .map((q) => q.value)
      .filter((v): v is number => v != null);
    const value = window.length >= 4 ? Math.round(mean(window) * 10) / 10 : null;
    return { day: p.day, value };
  });
  return { ...s, points };
}
