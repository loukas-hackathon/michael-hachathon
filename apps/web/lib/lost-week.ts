import type { Score } from "@michael/shared";
import { athensDay } from "./athens";
import { formatTime, formatWeekday } from "./format";

// Goal time lost per day of the week (Manolis, Sat night): from GET /v1/score `days[].lost_minutes`.
// It is time lost INSIDE planned goal blocks, not all screen time, so labels say "from goal blocks".

export type LostDay = {
  date: string;
  /** Null for days to come: drawn as an empty slot, never as a zero bar. */
  lost: number | null;
  planned: number;
};

export type LostWeek = {
  /** The day the score was asked for (today on Today, the selected day on Timeline). */
  date: string;
  today: string;
  days: LostDay[];
  total: number;
  /** Phone data arrives hours late: the last instant it covers, up to today (a local day in Athens). */
  phoneUntil: string | null;
  /** What took the week's lost goal time, most first (app, site or site category). */
  causes: LostCause[];
};

export type LostCause = { what: string; minutes: number };

export function lostWeekFrom(score: Score, today: string): LostWeek {
  const days = score.days.map((d) => ({
    date: d.date,
    lost: d.date > today ? null : d.lost_minutes,
    planned: d.planned_minutes,
  }));
  const iphone = score.data_until?.iphone ?? null;
  // `data_until` is an instant in UTC and `today` is a local day: compare local days on both sides,
  // or 00:00 to 02:00 in Athens lands on the day before.
  const phoneUntil =
    iphone && athensDay(new Date(iphone)) <= today && days.some((d) => d.date === today) ? iphone : null;
  return { date: score.date, today, days, total: score.lost_minutes, phoneUntil, causes: causesOf(score) };
}

/**
 * What took the week's lost time: `lost_by` from the score, most first. The total shown stays
 * `lost_minutes`; entries are rounded one by one and can differ from it by a few minutes.
 */
export function causesOf(score: Score): LostCause[] {
  return (score.lost_by ?? [])
    .filter((c) => c.minutes > 0)
    .map((c) => ({ what: c.what, minutes: c.minutes }));
}

/**
 * When the phone's data ends, as the Timeline says it: "01:30" when that is today in Athens, else
 * the local weekday with the time ("Saturday 23:10").
 */
export function phoneUntilLabel(phoneUntil: string, today: string): string {
  const time = formatTime(phoneUntil);
  return athensDay(new Date(phoneUntil)) === today ? time : `${formatWeekday(phoneUntil)} ${time}`;
}

/**
 * "What took it": the top three causes and the rest as one figure. The rest is the remainder of
 * the total, not the sum of the other entries, so the list always adds up to the number above it
 * (the entries are rounded one by one and can drift a few minutes).
 */
export function topCauses(causes: LostCause[], total: number) {
  const top = causes.slice(0, 3);
  const others = Math.max(0, causes.length - top.length);
  const shown = top.reduce((n, c) => n + c.minutes, 0);
  return { top, others, rest: others > 0 ? Math.max(0, total - shown) : 0 };
}

/** The day with the most goal time lost, for "Most on Tuesday." Null when nothing is lost. */
export function worstDay(w: LostWeek): LostDay | null {
  const past = w.days.filter((d): d is LostDay & { lost: number } => (d.lost ?? 0) > 0);
  return past.length ? past.reduce((a, b) => (b.lost > a.lost ? b : a)) : null;
}
