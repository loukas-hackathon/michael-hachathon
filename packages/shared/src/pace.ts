// The weekly pace: one definition for every place that says "behind pace" or "on pace by now"
// (the Goals screen, the goal_behind nudge and its reason). The inputs are the score's own numbers:
// `week_start`, `day.now` and a goal row's `budget_minutes`, `spent_minutes` and `minutes_left`.
//
//   Pace share   the part of the week gone by, 0 to 1: where every goal would be by now if its
//                budget were spread evenly from Monday 00:00 to Sunday 24:00.
//   On pace      budget x share, in whole minutes ("On pace: 5h 13 by now").
//   Behind by    on pace minus spent, never below 0 ("4h 02 behind pace").
//   Behind       the goal's share of its budget is more than 2 points under the pace share.
//   Book         what is left spread over the days to go, today included, in quarter hours between
//                30 and 90 minutes, and never more than what is left ("Book 90 minutes today").

const WEEK_MS = 7 * 86_400_000;
const instant = (t: string | number) => (typeof t === "number" ? t : Date.parse(t));

/** Share of the week gone by, 0 to 1. `weekStart` is Monday 00:00 local; both are instants. */
export function paceShare(weekStart: string | number, now: string | number): number {
  const share = (instant(now) - instant(weekStart)) / WEEK_MS;
  return Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
}

/** Where an even week would have the goal by now, in whole minutes. */
export function paceMinutes(budgetMinutes: number, share: number): number {
  return Math.round(budgetMinutes * share);
}

/** How far behind pace the goal is, in whole minutes; 0 when it is on pace or ahead. */
export function behindPaceMinutes(budgetMinutes: number, spentMinutes: number, share: number): number {
  return Math.max(0, paceMinutes(budgetMinutes, share) - spentMinutes);
}

/** The share of the week gone by minus the share of the budget spent: the larger, the further behind. */
export function paceShortfall(budgetMinutes: number, spentMinutes: number, share: number): number {
  return share - (budgetMinutes > 0 ? spentMinutes / budgetMinutes : 1);
}

/** True when the goal is behind pace: more than 2 points of its budget under the pace share. */
export function isBehindPace(budgetMinutes: number, spentMinutes: number, share: number): boolean {
  return paceShortfall(budgetMinutes, spentMinutes, share) > 0.02;
}

/** Days of the week still to go, today included: 7 on Monday, 1 on Sunday. */
export function paceDaysToGo(share: number): number {
  return 7 - Math.min(6, Math.floor(share * 7));
}

/** How long a block to book for a goal with `leftMinutes` to find over `daysToGo` days. */
export function bookMinutes(leftMinutes: number, daysToGo: number): number {
  const quarter = (m: number) => Math.ceil(m / 15) * 15;
  const even = quarter(leftMinutes / Math.max(1, daysToGo));
  return Math.max(15, Math.min(quarter(leftMinutes), Math.max(30, Math.min(90, even))));
}
