import type { Score } from "@michael/shared";

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
  const phoneUntil =
    iphone && iphone.slice(0, 10) <= today && days.some((d) => d.date === today) ? iphone : null;
  return { date: score.date, today, days, total: score.lost_minutes, phoneUntil, causes: [] };
}

/** Adds up `day.blocks[].lost[]` over the days given, by what took it, most first. */
export function causesFrom(dayScores: Score[]): LostCause[] {
  const by = new Map<string, number>();
  for (const s of dayScores)
    for (const b of s.day.blocks) for (const l of b.lost) by.set(l.what, (by.get(l.what) ?? 0) + l.minutes);
  return [...by]
    .map(([what, minutes]) => ({ what, minutes: Math.round(minutes) }))
    .filter((c) => c.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

/** The day with the most goal time lost, for "Most on Tuesday." Null when nothing is lost. */
export function worstDay(w: LostWeek): LostDay | null {
  const past = w.days.filter((d): d is LostDay & { lost: number } => (d.lost ?? 0) > 0);
  return past.length ? past.reduce((a, b) => (b.lost > a.lost ? b : a)) : null;
}
