import type { Score } from "@michael/shared";
import { athensDay } from "./athens";
import { formatTime } from "./format";

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
  /** Phone data arrives hours late: the last instant it covers, when that is today. */
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
  // The day in Athens, not the UTC date: 01:30 on Sunday in Athens is still Saturday in UTC.
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

/** The day with the most goal time lost, for "Most on Tuesday." Null when nothing is lost. */
export function worstDay(w: LostWeek): LostDay | null {
  const past = w.days.filter((d): d is LostDay & { lost: number } => (d.lost ?? 0) > 0);
  return past.length ? past.reduce((a, b) => (b.lost > a.lost ? b : a)) : null;
}

const DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * "Phone data up to 01:30, so today can still grow." The time is Athens time and so is the day:
 * phone data that ends at 01:30 today never reads as yesterday. Null when there is nothing to say.
 */
export function phoneLine(w: Pick<LostWeek, "phoneUntil" | "today">): string | null {
  if (!w.phoneUntil) return null;
  const at = new Date(w.phoneUntil);
  const day = athensDay(at);
  const name = DAY_NAME[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
  return `Phone data up to ${day === w.today ? "" : `${name} `}${formatTime(at)}, so today can still grow.`;
}
