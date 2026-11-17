import { countsTowardsCap, type NudgeCheckResult } from "@michael/shared";
import { revertExpiredGoalChanges } from "./actions/calendar";
import { generateDrafts } from "./actions/drafts";
import { runAsUser } from "./context";
import { env, webUrl } from "./env";
import { finishDueFocusSessions } from "./focus/session";
import { studyAhead } from "./insights/service";
import { prewarmMoment } from "./moments/prewarm";

import { HOUR } from "./patterns/time";
import { runRetention } from "./retention";
import { checkNudges } from "./routes/nudges";
import { store } from "./store";

// "Checks it often": the nudge check for every active user, every minute (#438), inside the always on
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

/**
 * The slower beat inside the tick (#438): the moment line written ahead and the follow up drafts
 * are worth a look every 5 minutes, not every minute. The web warm ping keeps this beat too.
 */
export const SLOW_EVERY_MS = 5 * 60_000;

/** How often sessions whose end has passed are finished. */
const FOCUS_TICK_MS = 30_000;

/** Follow ups are drafted for what ended this recently; older meetings are left alone. */
const DRAFT_WINDOW_MS = 2 * HOUR;

let running = false;
let lastSlowAt = Number.NEGATIVE_INFINITY;

/**
 * One pass: each active user's check runs scoped as that user, one after another. Null when the
 * pass before is still running: a tick is skipped, never stacked.
 */
export async function runNudgeChecks(now = Date.now()): Promise<UserCheck[] | null> {
  if (running) {
    console.warn("[scheduler] tick skipped: the last one is still running");
    return null;
  }
  running = true;
  // A second of slack, so a timer that fires a few ms early still counts as the fifth minute.
  const slow = now - lastSlowAt >= SLOW_EVERY_MS - 1000;
  if (slow) lastSlowAt = now;
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
      if (!slow) continue;
      // Today's moment line, written ahead so a cold open finds it cached (#378). One model call
      // only when the numbers changed since the last tick; not awaited, so no nudge waits on it.
      void runAsUser(userId, () => prewarmMoment(now));
      // What Michael has learnt: a study kept from today, so a nudge can cite it and the screen
      // opens at once; the discovery pass runs behind it when there is a new day of data.
      await runAsUser(userId, () => studyAhead(now)).catch((err) =>
        console.error(`[scheduler] insights failed for ${userId}`, err),
      );
      // Follow up drafts for conversations and meetings that just ended (#40). Once per event, so
      // a tick with nothing new costs one read and no model call.
      await runAsUser(userId, () => generateDrafts({ now, windowMs: DRAFT_WINDOW_MS })).catch((err) =>
        console.error(`[scheduler] follow up drafts failed for ${userId}`, err),
      );
    }
    const sent = out.filter(
      (c) => c.result?.nudge && countsTowardsCap(c.result.nudge.status, c.result.nudge.kind),
    ).length;
    // Every minute would drown the log: the line is written on the slow beat, or when one went out.
    if (users.length && (slow || sent)) {
      console.log(`[scheduler] checked ${users.length} users, ${sent} nudges`);
    }
    return out;
  } catch (err) {
    console.error("[scheduler] tick failed", err);
    return [];
  } finally {
    running = false;
  }
}

let demoCookie: string | null = null;
/** The tabs besides Today, asked as the router asks on a tap (RSC). */
const WARM_TABS = ["/timeline", "/goals", "/chat"];

/**
 * Keeps the web app's Today warm (#378): opens the demo week as one anonymous visitor, read only,
 * so the first open after hours meets a warm function, a warm API path and a phrased moment line.
 * Returns the time Today took, or null when it was skipped or failed. Never throws.
 */
export async function warmWeb(base = webUrl()): Promise<number | null> {
  if (!base || /localhost|127\.0\.0\.1/.test(base)) return null;
  try {
    if (!demoCookie) {
      const res = await fetch(`${base}/auth/demo`, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      demoCookie =
        res.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ") || null;
      if (!demoCookie) return null;
    }
    const start = performance.now();
    const res = await fetch(`${base}/`, {
      headers: { cookie: demoCookie, "user-agent": "michael-warm" },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    await res.arrayBuffer();
    // Redirected (the cookie expired): ask for a new visitor next time.
    if (res.status !== 200) demoCookie = null;
    const took = Math.round(performance.now() - start);
    // Coming back after hours (#502): the first taps are RSC requests for the other tabs, and a
    // signed out phone opens /login. Keep those paths warm too. Read only, the same visitor.
    const cookie = demoCookie;
    await Promise.all(
      [...WARM_TABS.map((path) => ({ path, rsc: true })), { path: "/login", rsc: false }].map(
        async ({ path, rsc }) => {
          try {
            const r = await fetch(`${base}${path}`, {
              headers: {
                "user-agent": "michael-warm",
                ...(rsc && cookie ? { cookie, rsc: "1" } : {}),
              },
              redirect: "manual",
              signal: AbortSignal.timeout(30_000),
            });
            await r.arrayBuffer();
          } catch {
            // One slow path never fails the warm-up.
          }
        },
      ),
    );
    return took;
  } catch (err) {
    console.warn("[scheduler] web warm failed", err instanceof Error ? err.message : err);
    return null;
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
  // Focus now (#397): sessions end on time with the app closed, so the watch buzzes at the minute.
  setInterval(
    () => void finishDueFocusSessions().catch((err) => console.error("[scheduler] focus", err)),
    FOCUS_TICK_MS,
  ).unref();
  // The web app's Today, kept warm (#378).
  if (env.WEB_WARM === "on") {
    // Its own beat: the nudge checks went to every minute (#438), the ping did not.
    const warmEvery = Math.max(every, SLOW_EVERY_MS);
    console.log(`[scheduler] web warm every ${warmEvery / 60_000} min`);
    setTimeout(() => void warmWeb(), 60_000).unref();
    setInterval(() => void warmWeb(), warmEvery).unref();
  }
  // Retention (#47): once a day, events older than 90 days become daily summaries. Also shortly
  // after each boot; a second pass the same day finds nothing to do.
  console.log("[scheduler] retention daily");
  setTimeout(() => void runRetention(), 2 * 60_000).unref();
  setInterval(() => void runRetention(), 24 * HOUR).unref();
}
