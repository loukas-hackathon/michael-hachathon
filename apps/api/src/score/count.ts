import type { ChecklistItem, Goal, ScoreChecklist, ScoreCount } from "@michael/shared";
import { HOUR, type Zone } from "../patterns/time";

// Count and checklist goals on the score (#238). Pure, like the rest of the score. Both stay
// outside the time score: they add a row to their goal, never a minute to any total.
//
// THE COUNT RULE (also in docs/api.md, "Score"; change both together)
//
//   A count goal (`target.kind: "count"`, `target.per_week`) counts occurrences this week. One
//   occurrence is any of:
//     block     an own calendar block of the goal (score/match.ts, matched among the count goals)
//               that has ended with at least half of it spent, by the same rule as the time
//               score (score.ts: spent = elapsed minus lost);
//     workout   a `workout` event that has ended and overlaps one of the goal's own blocks, names
//               the goal in `data.goal_id`, or has a title the goal lists in `calendar_titles`;
//     check_in  a check in question (#187) answered yes that names the goal, or names one of its
//               own blocks (score/check-in.ts); it takes the span of the block it asks about.
//   Occurrences on the same local day that overlap or are within an hour of each other count
//   once: the gym block and the watch's workout inside it are one session, a run in the morning
//   and the gym in the evening are two. A check in with no span of its own stands for the day's
//   session, so it adds one only on a day with no other occurrence.
//
//   done = the occurrences so far, target = per_week, left = target minus done (never below 0),
//   days_left = the days of the week that have not ended yet, today included. Behind pace: more
//   sessions left than days left.
//
// THE CHECKLIST ROW
//
//   set = items of the day that were not carried on (open, done, dropped); done = items done. A
//   carried item counts on the day it moved to, so the week never counts it twice.

export const COUNT_RULES = {
  /** Two occurrences closer than this on one day are one session. */
  mergeGapMs: HOUR,
  /** The share of an own block that must be spent for it to count. */
  minSpentShare: 0.5,
} as const;

export type OccurrenceSource = "block" | "workout" | "check_in";

export interface Occurrence {
  source: OccurrenceSource;
  start: number;
  end: number;
  /** A check in with no span: it stands for the day, not for a time. */
  untimed?: boolean;
}

/** The sessions the occurrences make, after the dedupe rule. */
export function countSessions(occurrences: Occurrence[], zone: Zone): number {
  const byDay = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const day = zone.dayOf(o.start);
    const list = byDay.get(day) ?? [];
    list.push(o);
    byDay.set(day, list);
  }
  let total = 0;
  for (const list of byDay.values()) {
    const timed = list.filter((o) => !o.untimed).sort((a, b) => a.start - b.start);
    let sessions = 0;
    let end = Number.NEGATIVE_INFINITY;
    for (const o of timed) {
      if (sessions === 0 || o.start > end + COUNT_RULES.mergeGapMs) sessions++;
      end = Math.max(end, o.end);
    }
    total += sessions > 0 ? sessions : list.length > 0 ? 1 : 0;
  }
  return total;
}

/** The goal's `target.per_week`, or 0 when it has none. */
export function perWeek(goal: Goal): number {
  const n = goal.target?.per_week;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;
}

/** The days of `days` that have not ended at `now`, today included. */
export const daysLeft = (days: string[], now: number, zone: Zone): number =>
  days.filter((d) => zone.startOfDay(zone.nextDay(d)) > now).length;

export function countRow(
  goal: Goal,
  occurrences: Occurrence[],
  days: string[],
  now: number,
  zone: Zone,
): ScoreCount {
  const target = perWeek(goal);
  const done = countSessions(occurrences, zone);
  return { done, target, left: Math.max(0, target - done), days_left: daysLeft(days, now, zone) };
}

/** True when more sessions are left than days. */
export const behindPace = (c: ScoreCount): boolean => c.left > c.days_left;

export function checklistRow(
  goalId: string,
  items: ChecklistItem[],
  date: string,
  days: string[],
): ScoreChecklist {
  const week = new Set(days);
  const own = items.filter((i) => i.goal_id === goalId && i.status !== "moved");
  const tally = (list: ChecklistItem[]) => ({
    set: list.length,
    done: list.filter((i) => i.status === "done").length,
  });
  return {
    today: tally(own.filter((i) => i.date === date)),
    week: tally(own.filter((i) => week.has(i.date))),
  };
}
