import { executeRecommendation } from "../actions/calendar";
import { logTime } from "../actions/log";
import { HttpError } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";

// The seam to the done time log (#317). The evening of the daily ritual (#318) hands every "I did
// 40 minutes of it" here, and it becomes a logged entry (actions/log.ts) that the goal's score
// counts as confirmed time: `counted: true`. A goal that is not measured in time or sessions (a
// checklist, a target), or one that is gone or paused, cannot take minutes: `counted: false`, and
// the minutes stay on the outcome itself (`checklist_items.logged_minutes`, written by the ritual).

export interface DoneTime {
  goal_id: string;
  minutes: number;
  /** The local day it was done. */
  day: string;
  /** The outcome in the user's words. */
  note: string;
}

export async function logDoneTime(entry: DoneTime, now = Date.now()): Promise<{ counted: boolean }> {
  const zone = new Zone(DEFAULT_TIMEZONE);
  // Today's minutes end now; an earlier day's end at its midnight.
  const end = Math.min(now, zone.startOfDay(zone.nextDay(entry.day)));
  try {
    await logTime(
      {
        goal_id: entry.goal_id,
        minutes: entry.minutes,
        note: entry.note.slice(0, 280) || undefined,
        end_at: new Date(end).toISOString(),
      },
      "app",
      executeRecommendation,
    );
    return { counted: true };
  } catch (err) {
    // Not a time or count goal, paused, gone, or outside the 14 days: kept on the outcome only.
    if (err instanceof HttpError && ["bad_request", "not_found", "conflict"].includes(err.code))
      return { counted: false };
    throw err;
  }
}
