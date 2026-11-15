import type { ShortcutsPayload } from "./ios-shortcuts";

// The phone, as it happens. The iPhone shortcut posts every app open within a second or two
// (docs/sources/ios-shortcuts.md), but an open only becomes a stored `app_usage` event when the
// next open (or a close) ends it: the app in front right now is not in the database yet, and the
// same app opened again is not a new event at all. The real time nudges (nudges/realtime.ts) need
// both, so every signal is also kept here, in memory, for a few hours.
//
// In memory on purpose, like the pairer's held open: a restart loses the signals of the last hours,
// and the stored events still carry every open that was closed by the next one.

export interface LiveSignal {
  app: string;
  action: "open" | "close";
  /** Epoch ms. */
  at: number;
}

/** Signals older than this are dropped: no block and no night is longer. */
export const LIVE_KEEP_MS = 12 * 3600_000;
const MAX_PER_USER = 500;

export class PhoneLive {
  private byUser = new Map<string, LiveSignal[]>();

  /** One signal from the shortcut, with the same clock rule as the pairer (`at`, else the arrival). */
  record(userId: string, p: Pick<ShortcutsPayload, "app" | "action" | "at">, arrivedAt: number): void {
    const parsed = p.at ? Date.parse(p.at) : Number.NaN;
    const at = Number.isFinite(parsed) ? parsed : arrivedAt;
    const list = (this.byUser.get(userId) ?? []).filter((s) => s.at > arrivedAt - LIVE_KEEP_MS);
    list.push({ app: p.app, action: p.action, at });
    list.sort((a, b) => a.at - b.at);
    this.byUser.set(userId, list.slice(-MAX_PER_USER));
  }

  /** The user's signals from `from` on, oldest first. */
  since(userId: string, from: number): LiveSignal[] {
    return (this.byUser.get(userId) ?? []).filter((s) => s.at >= from);
  }

  /** Tests only. */
  clear(): void {
    this.byUser.clear();
  }
}

/** One instance for the life of the API process. */
export const phoneLive = new PhoneLive();
