import { isNap } from "@michael/shared";
import type { Zone } from "./time";

/**
 * Whether a sleep from `start` to `end` is a nap in the user's time zone: under 3 hours, starting
 * 09:00 to 20:00 (packages/shared/src/sleep.ts, the same rule the web uses). A nap is never the
 * night: it never counts toward the Sleep goal, never wakes the Morning moment and never teaches
 * the usual bedtime.
 */
export const napIn = (zone: Zone, start: number, end: number): boolean =>
  isNap(start, end, zone.minuteOfDay(start) / 60);
