import type { Recommendation, RecommendationAction } from "@michael/shared";
import { currentUserId } from "../context";
import { HttpError } from "../http";
import { store } from "../store";

// Do Not Disturb, asked then done (#447). The product rule: Michael asks, one tap, he does it, it
// ends by itself, and the user can end it sooner. A server cannot set a Focus, so "doing it" is
// two things: a `do_not_disturb` recommendation carried out at once (this file: logged like every
// other action, shown on Today, undone through the same route), and a device that reads it and
// runs the signed Michael Focus shortcut (the Mac collector, apps/collector/src/dnd.ts, or the
// hand over page on the iPhone, apps/web/app/dnd).
//
// What is on now is kept in memory per user and read back from the recommendations once after a
// restart, so the collector's poll costs no query while it is on. Only one is on at a time: a
// newer one replaces it.

/** Not for longer than this: it is for a block or for one night. */
export const MAX_DND_MS = 12 * 3600_000;
/** Not worth switching on for less. */
export const MIN_DND_MS = 60_000;

export interface DndExecution {
  kind: "do_not_disturb";
  until: string;
  undo_until: string;
}

export interface ActiveDnd {
  id: string;
  until: string;
  /** When it starts, for one switched on ahead of its hours (the busiest window, dnd/window.ts). */
  from?: string;
}

/** Per user: the one on now, null when none is, missing when not read since the process started. */
const active = new Map<string, ActiveDnd | null>();

const endOf = (action: RecommendationAction): number =>
  typeof action.payload.end_at === "string" ? Date.parse(action.payload.end_at) : Number.NaN;
/** When it starts: `start_at` for a window ahead (dnd/window.ts), else at the tap. */
const startOf = (action: RecommendationAction, now: number): number =>
  typeof action.payload.start_at === "string" ? Math.max(Date.parse(action.payload.start_at), now) : now;
/** Never set more than a day ahead. */
const MAX_AHEAD_MS = 24 * 3600_000;

/** Carries out a do_not_disturb action: from now it is on for the user's devices to pick up. */
export async function switchOnDnd(rec: Recommendation, action: RecommendationAction): Promise<DndExecution> {
  const end = endOf(action);
  const now = Date.now();
  const start = startOf(action, now);
  if (!Number.isFinite(end) || !Number.isFinite(start)) {
    throw new HttpError("bad_request", "Do Not Disturb needs a time to end");
  }
  if (end - start < MIN_DND_MS) throw new HttpError("conflict", "That time has already passed");
  if (end - start > MAX_DND_MS) throw new HttpError("bad_request", "Do Not Disturb is at most 12 hours");
  if (start - now > MAX_AHEAD_MS)
    throw new HttpError("bad_request", "Do Not Disturb is set at most a day ahead");
  const until = new Date(end).toISOString();
  const from = start > now ? new Date(start).toISOString() : undefined;
  active.set(currentUserId(), { id: rec.id, until, ...(from ? { from } : {}) });
  return { kind: "do_not_disturb", until, undo_until: until };
}

/**
 * Undo: it is off from now; the Mac switches it off on its next look. An older one that a newer
 * one already replaced changes nothing.
 */
export function switchOffDnd(ex: DndExecution): void {
  const userId = currentUserId();
  const current = active.get(userId);
  if (!current || current.until === ex.until) active.set(userId, null);
}

/** The Do Not Disturb that is on for the current user at `now`, or null. */
export async function activeDnd(now = Date.now()): Promise<ActiveDnd | null> {
  const userId = currentUserId();
  let current = active.get(userId);
  if (current === undefined) {
    // First look since the process started: the last one carried out that has not ended.
    const done = await store.listRecommendations({ status: "done" });
    const last = done
      .filter((r) => r.action?.kind === "do_not_disturb" && endOf(r.action) > now)
      .sort(
        (a, b) => Date.parse(b.executed_at ?? b.created_at) - Date.parse(a.executed_at ?? a.created_at),
      )[0];
    const from =
      last?.action && typeof last.action.payload.start_at === "string"
        ? last.action.payload.start_at
        : undefined;
    current = last?.action
      ? { id: last.id, until: new Date(endOf(last.action)).toISOString(), ...(from ? { from } : {}) }
      : null;
    active.set(userId, current);
  }
  if (current && Date.parse(current.until) <= now) {
    active.set(userId, null);
    return null;
  }
  // Set ahead (the busiest window): kept, but not on until its hour comes.
  if (current?.from && Date.parse(current.from) > now) return null;
  return current ? { id: current.id, until: current.until } : null;
}

// ---------- the Mac ----------

/** A Mac counts as there while its collector looked this recently (it looks every 15 seconds). */
export const MAC_SEEN_MS = 2 * 60_000;

const macs = new Map<string, { shortcut: boolean; at: number }>();

/** The Mac collector's look (GET /v1/focus-guards/active?dnd=ready|missing): is the shortcut there. */
export function noteMac(shortcut: boolean, now = Date.now()): void {
  macs.set(currentUserId(), { shortcut, at: now });
}

/** `ready`: a Mac is there with the shortcut; `no_shortcut`: there without it; `away`: no Mac lately. */
export function macState(now = Date.now()): "ready" | "no_shortcut" | "away" {
  const mac = macs.get(currentUserId());
  if (!mac || now - mac.at > MAC_SEEN_MS) return "away";
  return mac.shortcut ? "ready" : "no_shortcut";
}

/** Tests only. */
export function resetDnd(): void {
  active.clear();
  macs.clear();
}
