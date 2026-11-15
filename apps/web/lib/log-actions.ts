"use server";

import { revalidatePath } from "next/cache";
import { type LogResult, postBlockSettle, postLog, undoRecommendation } from "./api";
import { athensDay, athensMidnight } from "./athens";

// Server functions behind Log time (Today, Goals) and Did it / Didn't (Timeline), #317. Only the
// server talks to the API, with the signed-in user's token. Everything from the browser is checked.

export type LogActionResult =
  | { ok: true; message: string; recommendationId: string }
  | { ok: false; error: string };

const ID = /^[0-9a-f-]{36}$/i;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The instant of "HH:MM" today in Athens; yesterday when that is still ahead. */
function startFrom(clock: string, minutes: number, now = Date.now()): string | null {
  const m = CLOCK.exec(clock);
  if (!m) return null;
  const offset = (Number(m[1]) * 60 + Number(m[2])) * 60_000;
  let start = athensMidnight(athensDay(now)) + offset;
  // "At 23:00" said at 08:00 means last night.
  if (start + minutes * 60_000 > now + 60_000) start -= 86_400_000;
  return new Date(start).toISOString();
}

function done(r: LogResult): LogActionResult {
  if (!r.ok) return { ok: false, error: r.message };
  // The score, the goals and the timeline all read the new entry.
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath("/timeline");
  return { ok: true, message: r.log.message, recommendationId: r.log.recommendation.id };
}

/** "I did 30 min" of a goal: ending now, or from a clock time today. */
export async function logTimeAction(input: {
  goalId: string;
  minutes: number;
  at?: string | null;
}): Promise<LogActionResult> {
  const minutes = Math.round(Number(input.minutes));
  if (typeof input.goalId !== "string" || !ID.test(input.goalId)) return { ok: false, error: "Pick a goal." };
  if (!(minutes >= 1 && minutes <= 960)) return { ok: false, error: "Give the minutes, 1 to 960." };
  const start_at = input.at ? startFrom(input.at, minutes) : null;
  if (input.at && !start_at) return { ok: false, error: "Give the time as HH:MM." };
  return done(await postLog({ goal_id: input.goalId, minutes, ...(start_at ? { start_at } : {}) }));
}

/** Did it (all of it, or `minutes`) or Didn't on a past goal block. */
export async function settleBlockAction(input: {
  eventId: string;
  did: boolean;
  minutes?: number | null;
}): Promise<LogActionResult> {
  if (typeof input.eventId !== "string" || !ID.test(input.eventId))
    return { ok: false, error: "That block is not on the timeline." };
  const minutes = input.minutes ? Math.round(Number(input.minutes)) : undefined;
  return done(
    await postBlockSettle({
      event_id: input.eventId,
      did: input.did === true,
      ...(minutes && minutes > 0 ? { minutes } : {}),
    }),
  );
}

/** Takes a logged entry back (its recommendation's undo). */
export async function undoLogAction(recommendationId: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof recommendationId !== "string" || !ID.test(recommendationId))
    return { ok: false, error: "Nothing to undo." };
  const r = await undoRecommendation(recommendationId).catch(() => null);
  if (!r?.ok) return { ok: false, error: r?.message ?? "I lost the line. It's still logged." };
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath("/timeline");
  return { ok: true };
}
