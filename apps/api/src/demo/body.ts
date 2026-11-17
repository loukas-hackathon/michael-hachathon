// The morning's recovery, for the stage account: one rule for the week (demo/week.ts) and for the
// weeks before it (demo/history.ts), so the recovery line reads the same way across all twelve.

/** Under this many minutes asleep a night is short (6h 40). */
export const SHORT_NIGHT_MINUTES = 400;
/** A workout that ends after this local minute of the day (21:30) is a late one. */
export const LATE_WORKOUT_MINUTE = 21 * 60 + 30;

/**
 * Recovery, 8 to 97%. A sleep score of 85 reads 64%; each point of score moves it by about one and
 * a half; a second short night in a row takes 9 more, a late hard workout the evening before 3.
 * `noise` is a number from 0 to 1, drawn per day by the caller.
 */
export function recoveryPct(input: {
  score: number;
  twoShort: boolean;
  lateHard: boolean;
  noise: number;
}): number {
  const raw =
    64 +
    1.45 * (input.score - 85) -
    (input.twoShort ? 9 : 0) -
    (input.lateHard ? 3 : 0) +
    (input.noise - 0.5) * 10;
  return Math.max(8, Math.min(97, Math.round(raw)));
}
