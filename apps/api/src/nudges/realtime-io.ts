import type { Event, Goal } from "@michael/shared";
import { currentUserId } from "../context";
import { LIVE_KEEP_MS, phoneLive } from "../ingest/phone-live";
import { goalBlocks } from "../patterns/focus";
import { HOUR, MINUTE } from "../patterns/time";
import { store } from "../store";
import { learntFor } from "./learnt";
import { phoneUse, REALTIME, type RealtimeInput, type RealtimeTrigger } from "./realtime";

// The I/O side of the real time rules (nudges/realtime.ts): what the route reads for them on top
// of the week's events. By day it costs no query at all (the live signals are in memory). While
// the phone is in use late in the evening it costs two: last evening's nudges, so a night is
// nudged once on both sides of midnight, and tomorrow's calendar, for the first block.

/** How far ahead the first block after tonight is looked for. */
const AHEAD_MS = 18 * HOUR;

export async function realtimeInput(
  now: string,
  win: { dayStart: string },
  events: Event[],
  goals: Goal[],
  test?: RealtimeTrigger,
): Promise<RealtimeInput> {
  const at = Date.parse(now);
  const live = phoneLive.since(currentUserId(), at - LIVE_KEEP_MS);
  const input: RealtimeInput = { live, ...(test ? { test } : {}) };
  const use = phoneUse(events, live, at - 3 * HOUR, at).reduce((a, s) => a + s.end - s.start, 0);
  if (use === 0 && !test) return input;
  input.learnt = { phone_block: await learntFor("phone_block") };
  // Worth the two reads only when the phone has been in use for a while in the last hours.
  if (use < (REALTIME.lateMinutes * MINUTE) / 2 && test !== "late_phone") return input;
  const dayStart = Date.parse(win.dayStart);
  const [earlier, ahead, late] = await Promise.all([
    store
      .listNudges({ from: new Date(dayStart - 12 * HOUR).toISOString(), to: win.dayStart })
      .catch(() => []),
    store
      .listEvents({ from: now, to: new Date(at + AHEAD_MS).toISOString(), type: ["calendar_event"] })
      .catch(() => [] as Event[]),
    learntFor("late_phone"),
  ]);
  input.earlierKeys = earlier.filter((n) => n.status !== "test").map((n) => n.key);
  // The first block that starts after now: a block still running tonight is not "first".
  const first = goalBlocks(ahead, goals, at, at + AHEAD_MS).find((b) => b.start > at);
  input.firstBlockAt = first ? new Date(first.start).toISOString() : null;
  input.learnt.late_phone = late;
  return input;
}
