// The nap rule, shared by the API score (apps/api/src/score/week.ts) and the web (apps/web/lib/
// health.ts) so they never drift. No zod here: the Timeline's client code imports this file
// directly as "@michael/shared/sleep", and must not pull in the schemas.
//
// A sleep shorter than 3 hours that starts between 09:00 and 20:00 local time is a nap. A nap is a
// small block in the day, never the night, and never counts toward the Sleep goal.

/** Naps are shorter than this. */
export const NAP_MAX_MINUTES = 180;
/** Naps start at or after this local hour... */
export const NAP_FROM_HOUR = 9;
/** ...and before this one. */
export const NAP_UNTIL_HOUR = 20;

/**
 * Whether a sleep is a nap. `startLocalHour` is the start's local time of day in hours (14.5 is
 * 14:30), worked out by the caller in the user's time zone.
 */
export function isNap(startMs: number, endMs: number, startLocalHour: number): boolean {
  return (
    endMs - startMs < NAP_MAX_MINUTES * 60_000 &&
    startLocalHour >= NAP_FROM_HOUR &&
    startLocalHour < NAP_UNTIL_HOUR
  );
}

/** A full night, in minutes: the duration that earns the whole duration part of the score. */
export const SLEEP_SCORE_FULL_NIGHT_MINUTES = 480;

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A night's sleep score, 0 to 100, from a `sleep` event's `data`. The one rule every reader uses:
 * `data.score` when the source sent one; else worked out from the night itself. Half of it is the
 * duration against 8 hours, a quarter is deep plus REM against 40% of the night, a quarter is how
 * little of the time in bed was spent awake (15% awake or more earns nothing). A part the source
 * did not send is left out and the rest carries its weight, so a night with only a duration is
 * scored on the duration. `spanMinutes` (end minus start) stands in for a missing `duration_min`.
 * Null when there is no duration at all.
 */
export function sleepScore(data: Record<string, unknown>, spanMinutes?: number | null): number | null {
  const sent = finite(data.score);
  if (sent !== null) return Math.round(Math.min(100, Math.max(0, sent)));
  const duration = finite(data.duration_min) ?? spanMinutes ?? null;
  if (duration === null || !(duration > 0)) return null;
  const parts: [weight: number, value: number][] = [
    [0.5, Math.min(1, duration / SLEEP_SCORE_FULL_NIGHT_MINUTES)],
  ];
  const deep = finite(data.deep_min);
  const rem = finite(data.rem_min);
  if (deep !== null || rem !== null) {
    parts.push([0.25, Math.min(1, ((deep ?? 0) + (rem ?? 0)) / (0.4 * duration))]);
  }
  const awake = finite(data.awake_min);
  if (awake !== null) parts.push([0.25, 1 - Math.min(1, awake / (0.15 * (duration + awake)))]);
  const weight = parts.reduce((t, [w]) => t + w, 0);
  return Math.round((100 * parts.reduce((t, [w, v]) => t + w * v, 0)) / weight);
}
