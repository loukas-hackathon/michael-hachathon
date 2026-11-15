import type { MomentKind } from "@michael/shared";
import { runAsUser } from "../context";
import { zone } from "../mcp-format";
import { momentFor } from "../routes/moments";

// Today never waits for the model (#378): the moment card's line is written ahead, so a cold open
// usually finds it cached. The scheduler phrases the current moment for recently active users on
// every tick, and a user's writes (new events, a moved block) phrase it again a minute later.
// Reads and an in-memory line only: nothing is written to the user's data.

// The same hours as Today's moment card (apps/web/lib/day.ts, cardMomentAt).
const MORNING_UNTIL = 11;
const EVENING_FROM = 20;

/** Which moment card Today shows at this instant, Athens time, or null in the middle of the day. */
export function cardMomentAt(ms: number): MomentKind | null {
  const h = zone.hourOf(ms);
  if (h < MORNING_UNTIL) return "morning";
  if (h >= EVENING_FROM) return "evening";
  return null;
}

/** Phrases the current user's moment card now, when one shows. Never throws. */
export async function prewarmMoment(now = Date.now()): Promise<boolean> {
  const kind = cardMomentAt(now);
  if (!kind) return false;
  try {
    const m = await momentFor(kind, new Date(now).toISOString());
    return m.phrased_by === "model";
  } catch (err) {
    console.error("[moments] prewarm failed", err);
    return false;
  }
}

const AFTER_WRITE_MS = 60_000;
const timers = new Map<string, NodeJS.Timeout>();

/**
 * After a user's writes: phrase their moment again once things settle (a minute after the last
 * write), so the next open of Today finds the line for the new numbers.
 */
export function prewarmAfterWrite(userId: string): void {
  if (!cardMomentAt(Date.now())) return;
  clearTimeout(timers.get(userId));
  const timer = setTimeout(() => {
    timers.delete(userId);
    void runAsUser(userId, () => prewarmMoment());
  }, AFTER_WRITE_MS);
  timer.unref();
  timers.set(userId, timer);
}
