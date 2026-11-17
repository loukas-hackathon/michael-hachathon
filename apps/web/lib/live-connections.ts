import type { ConnectionId } from "./connections";
import type { ConnectionState } from "./connections-status";

// What GET /live/connections answers, and the pure rules the live rows follow (#466). Safe on the
// client: types and plain functions only.

export type LiveConnection = { id: ConnectionId; state: ConnectionState; fresh: string | null };

/** Poll every 2 s while a connection is on its way, for at most 2 minutes. */
export const POLL_MS = 2_000;
export const WAIT_MS = 120_000;
/** After it lands, the row keeps saying what arrived, live, for a minute. */
export const FRESH_MS = 60_000;

/** Connected, as far as the row is concerned: sending or linked. */
export const isOn = (s: ConnectionState | undefined) => s === "on";

/**
 * The connections that just landed: on now, not on before. A connection we knew nothing about
 * before (no baseline) never counts, so a first read never animates.
 */
export function landed(
  before: ReadonlyMap<ConnectionId, ConnectionState>,
  now: readonly LiveConnection[],
): ConnectionId[] {
  return now.filter((r) => isOn(r.state) && before.has(r.id) && !isOn(before.get(r.id))).map((r) => r.id);
}

/** The row's line: the state word, and once connected and fresh, what arrived. */
export function rowLine(word: string, fresh: string | null | undefined, showFresh: boolean): string {
  return showFresh && fresh ? `${word} · ${fresh}` : word;
}

/** "Waiting for Telegram…" */
export const waitingLine = (name: string) => `Waiting for ${name}…`;

/** The connection a return URL says just connected (?connected=google_calendar). */
export function arrivedFrom(param: string | null | undefined): ConnectionId | null {
  if (param === "google_calendar") return "google-calendar";
  if (param === "claude" || param === "nudges" || param === "telegram") return param;
  return null;
}
