import { countsTowardsCap, type NudgeCheckResult } from "@michael/shared";
import { revertExpiredGoalChanges } from "./actions/calendar";
import { runAsUser } from "./context";
import { env } from "./env";
import { HOUR } from "./patterns/time";
import { runRetention } from "./retention";
import { checkNudges } from "./routes/nudges";
import { store } from "./store";

// "Checks it often": the nudge check for every active user, on an interval, inside the always on
// API process on Railway. Chosen over a Railway cron service because it needs no second service,
// no secret and no public trigger endpoint. Overlap is safe twice over: the in process lock below
// skips a tick while the last one runs, and the nudges table's unique (user_id, day, key) index
// stops a second replica or a restart from sending the same nudge twice.
// Source syncs and analysis (#13, #17) can join `tick` once they exist.

/** A user counts as active when events arrived in this window. */
export const ACTIVE_WINDOW_MS = 24 * HOUR;

export interface UserCheck {
  userId: string;
  result?: NudgeCheckResult;
  error?: string;
}

let running = false;

/** One pass: each active user's check runs scoped as that user, one after another. */
export async function runNudgeChecks(now = Date.now()): Promise<UserCheck[] | null> {
  if (running) return null;
  running = true;
  try {
    const since = new Date(now - ACTIVE_WINDOW_MS).toISOString();
    const users = await store.activeUserIds(since);
    const out: UserCheck[] = [];
    for (const userId of users) {
      try {
        const result = await runAsUser(userId, async () => {
          // Temporary goal changes from chat (#188) end on time even when nobody opens the app.
          await revertExpiredGoalChanges().catch((err) => console.error("[scheduler] goal revert", err));
          return checkNudges();
        });
        out.push({ userId, result });
      } catch (err) {
        console.error(`[scheduler] nudge check failed for ${userId}`, err);
        out.push({ userId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const sent = out.filter((c) => c.result?.nudge && countsTowardsCap(c.result.nudge.status)).length;
    if (users.length) console.log(`[scheduler] checked ${users.length} users, ${sent} nudges`);
    return out;
  } catch (err) {
    console.error("[scheduler] tick failed", err);
    return [];
  } finally {
    running = false;
  }
}

/** Starts the interval when enabled. Errors are logged, never thrown. */
export function startScheduler(): void {
  if (!env.SCHEDULER_ENABLED) {
    console.log("[scheduler] off (SCHEDULER_ENABLED)");
    return;
  }
  const every = env.SCHEDULER_INTERVAL_MINUTES * 60_000;
  console.log(`[scheduler] nudge checks every ${env.SCHEDULER_INTERVAL_MINUTES} min`);
  // First pass shortly after boot, once the health check has passed.
  setTimeout(() => void runNudgeChecks(), 30_000).unref();
  setInterval(() => void runNudgeChecks(), every).unref();
  // Retention (#47): once a day, events older than 90 days become daily summaries. Also shortly
  // after each boot; a second pass the same day finds nothing to do.
  console.log("[scheduler] retention daily");
  setTimeout(() => void runRetention(), 2 * 60_000).unref();
  setInterval(() => void runRetention(), 24 * HOUR).unref();
}
