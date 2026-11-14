import { categoriseHost, type PatternSubject } from "@michael/shared";

// Plain data sentences for a developer and a model. Voice basics still apply: numbers first,
// British spelling, 24 hour time, no dashes, no exclamation marks.

/** Under 2 hours: minutes ("21 minutes", "45 seconds" under a minute). From 2 hours: "2h 15". */
export function duration(minutes: number): string {
  if (minutes < 1) {
    const seconds = Math.max(0, Math.round(minutes * 60));
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }
  if (minutes < 120) {
    const shown =
      minutes < 10 && !Number.isInteger(minutes) ? Math.round(minutes * 10) / 10 : Math.round(minutes);
    return `${shown} ${shown === 1 ? "minute" : "minutes"}`;
  }
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}`;
}

export const pct = (share: number) => `${Math.round(share * 100)}%`;

/** "09:00", "18:00", "24:00". */
export const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** Minutes after midnight to "HH:MM", wrapping past 24:00. */
export function clockLabel(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One decimal under 10, whole numbers from 10 ("3.4 a day", "26 a day"). */
export const rate = (n: number) => String(n < 10 ? Math.round(n * 10) / 10 : Math.round(n));

/**
 * How a summary names an app or a site. Apps go by name. A site goes by host only when it is on
 * the public category list; any other host stays out of the sentence, because summaries are what
 * the model sees and an unlisted address can be private.
 */
export function label(subject: PatternSubject): string {
  if (subject.kind === "app") return subject.name;
  if (categoriseHost(subject.key) !== "other") return subject.name;
  return subject.category === "other" ? "an uncategorised site" : `a ${subject.category} site`;
}

export const days = (n: number) => count(n, "day");
