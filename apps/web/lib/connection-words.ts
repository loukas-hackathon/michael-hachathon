import type { ConnectionState } from "./connections-status";

// The list says the state in the same words on every row (You, and its list on a laptop); the
// detail ("Last data 3 min ago", "Connected as ...") is on the connection's own page.
export const STATE_WORDS: Record<ConnectionState, string> = {
  on: "Connected",
  none: "Not connected",
  optional: "Optional",
  paused: "Paused",
  attention: "Needs attention",
  unavailable: "Not available yet",
  unknown: "Could not check",
  soon: "Coming soon",
};
