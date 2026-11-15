import { type ConfirmationKind, confirmation } from "@michael/shared";
import { currentUserId } from "./context";
import { DEFAULT_TIMEZONE } from "./patterns";
import { Zone } from "./patterns/time";

/**
 * Michael's confirmation for the current user ("Logged 40 min.", "40 min in the book."): one
 * phrasing per person per Athens day, so a reply reads the same on every reload and tests stay stable.
 */
export function confirm(
  kind: ConfirmationKind,
  values: Parameters<typeof confirmation>[2] = {},
  now = Date.now(),
): string {
  let user = "";
  try {
    user = currentUserId();
  } catch {
    // Outside a request (a script): the day alone picks the phrasing.
  }
  return confirmation(kind, `${new Zone(DEFAULT_TIMEZONE).dayOf(now)}:${user}`, values);
}
