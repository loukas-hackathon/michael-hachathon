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
