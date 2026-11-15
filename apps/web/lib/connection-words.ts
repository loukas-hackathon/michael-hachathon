import type { ConnectionState } from "./connections-status";

// The list says the state in the same words on every row (You, its list on a laptop, onboarding);
// the detail ("Last data 3 min ago", "Connected as ...") is on the connection's own page. Four words
// only (#466): a row is Connected, Not connected, Paused or Needs attention, nothing else.
export const STATE_WORDS: Record<ConnectionState, string> = {
  on: "Connected",
  none: "Not connected",
  // Not needed (no Mac), still connectable: the row keeps Connect.
  optional: "Not connected",
  paused: "Paused",
  attention: "Needs attention",
  // Not ready on our side, or a status we could not read: Manage says why on its page.
  unavailable: "Needs attention",
  unknown: "Needs attention",
  soon: "Not connected",
};

/** Connections that finish outside the app: the row waits for the first event or link (#466). */
export const FINISH_ELSEWHERE: ReadonlySet<string> = new Set([
  "telegram",
  "mac",
  "apple-watch",
  "iphone",
  "claude",
]);
