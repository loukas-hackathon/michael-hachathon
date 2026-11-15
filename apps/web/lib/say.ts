import { type ConfirmationKind, confirmation } from "@michael/shared/voice";
import { athensDay } from "./athens";

// Michael's confirmations in the app ("Undone.", "Taken back.", "Moved Gym to 18:00."): one phrasing
// a day, the same on the server and in the browser, so a reload never changes what he just said.
// The browser has no user id to hand, so the Athens day is the seed; the API adds the user (#398).

export function say(
  kind: ConfirmationKind,
  values: Parameters<typeof confirmation>[2] = {},
  now: Date | number = new Date(),
): string {
  return confirmation(kind, athensDay(now), values);
}

/** "Undone." in today's phrasing, then what is back: "Taken back. Your calendar is back as it was." */
export const undoneLine = (rest: string, now?: Date | number) => `${say("undone", {}, now)} ${rest}`;
