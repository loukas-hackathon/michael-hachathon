import type { TimeWindow } from "@michael/shared";
import { ZONE } from "./athens";

// Quiet hours (You, Nudges): no nudges inside the window, and the Mi button rests asleep (#319).
// The window may cross midnight (22:00 to 07:00 is the default).

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** True when the Athens wall clock at `at` falls inside `quiet`. */
export function inQuietHours(quiet: TimeWindow, at: Date | number = new Date()): boolean {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  const now = minutesOf(clock);
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
