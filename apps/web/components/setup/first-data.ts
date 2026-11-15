// Pure logic for the live first data check on setup pages (#306, #307). No React, so it is tested
// with node:test. The page notes the latest arrival when the person starts (the baseline), then
// asks again every few seconds: anything newer than the baseline proves the whole path works.

export type WatchedConnection = "apple-watch" | "mac" | "iphone";

/** How long to wait before saying exactly which step to recheck. */
export const LATE_AFTER_MS = 2 * 60_000;
/** Stop asking after this long; the status line at the top keeps the truth from then on. */
export const GIVE_UP_AFTER_MS = 10 * 60_000;
/** How often to ask while waiting. */
export const POLL_MS = 5_000;

export type FirstData =
  | { kind: "waiting" }
  | { kind: "arrived"; at: string }
  | { kind: "late" }
  | { kind: "stopped" };

/**
 * `baseline`: the latest arrival when the watch started (null: never). `last`: the latest now.
 * Server times on both sides, so the phone's clock never matters.
 */
export function firstDataState(
  baseline: string | null,
  last: string | null,
  startedAt: number,
  now: number,
): FirstData {
  if (last && last !== baseline && (!baseline || Date.parse(last) > Date.parse(baseline)))
    return { kind: "arrived", at: last };
  const waited = now - startedAt;
  if (waited >= GIVE_UP_AFTER_MS) return { kind: "stopped" };
  if (waited >= LATE_AFTER_MS) return { kind: "late" };
  return { kind: "waiting" };
}

/** "just now", "2 min ago", "3h ago". Same words as the Connections rows. */
export function sinceLine(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/** The one step to recheck when nothing has arrived after two minutes. */
export const RECHECK: Record<WatchedConnection, string> = {
  "apple-watch":
    "Nothing yet. In Health Auto Export, open Automations, tap Michael health, then Export Now. If it asks for Health access, allow it.",
  mac: "Nothing yet. Check the Michael line in Terminal finished without an error, then use your Mac for a minute.",
  iphone:
    "Nothing yet. Open an app you picked. Then check Shortcuts, Automation lists it with Run Immediately.",
};

export const WAITING_LINE = "Waiting for your first data. This updates by itself.";
export const STOPPED_LINE = "Still nothing. Recheck the steps above, then come back to this page.";

export function firstDataLine(c: WatchedConnection, s: FirstData, now: number): string {
  switch (s.kind) {
    case "arrived":
      return `Connected. Last data ${sinceLine(s.at, now)}.`;
    case "late":
      return RECHECK[c];
    case "stopped":
      return STOPPED_LINE;
    case "waiting":
      return WAITING_LINE;
  }
}
