import { runAsUser } from "./context";
import { store } from "./store";
import { retentionCutoff, summariseEvents } from "./summaries";

export { eventCategory, eventSeconds, mergeSummaries, retentionCutoff, summariseEvents } from "./summaries";

// Retention (#47, AGENTS.md Privacy): full detail for 90 days, then summaries. Once a day the
// scheduler rolls every event that started more than RETENTION_DAYS ago into daily totals
// (event_summaries) and deletes the raw rows. Summaries keep counts and time only: no titles, no data.

/** Events read, summarised and deleted per round trip. */
export const RETENTION_BATCH = 500;

export interface RetentionResult {
  users: number;
  summarised: number;
  deleted: number;
  errors: number;
}

/** Rolls up the current user's events that started before `cutoff`, batch by batch. */
export async function rollUpCurrentUser(cutoff: string): Promise<{ summarised: number; deleted: number }> {
  let summarised = 0;
  let deleted = 0;
  for (;;) {
    const batch = await store.listEventsBefore(cutoff, RETENTION_BATCH);
    if (!batch.length) break;
    // Summaries first: if the delete then fails, the next run can only over count, never lose time.
    await store.addEventSummaries(summariseEvents(batch));
    summarised += batch.length;
    deleted += await store.deleteEvents(batch.map((e) => e.id));
    if (batch.length < RETENTION_BATCH) break;
  }
  return { summarised, deleted };
}

let running = false;

/** One daily pass for every user with old events. Each runs scoped as that user. */
export async function runRetention(now = Date.now()): Promise<RetentionResult | null> {
  if (running) return null;
  running = true;
  try {
    const cutoff = retentionCutoff(now);
    const users = await store.usersWithEventsBefore(cutoff);
    const result: RetentionResult = { users: users.length, summarised: 0, deleted: 0, errors: 0 };
    for (const userId of users) {
      try {
        const r = await runAsUser(userId, () => rollUpCurrentUser(cutoff));
        result.summarised += r.summarised;
        result.deleted += r.deleted;
      } catch (err) {
        result.errors++;
        console.error(`[retention] roll up failed for ${userId}`, err);
      }
    }
    if (users.length) {
      console.log(
        `[retention] ${users.length} users, ${result.deleted} events older than ${cutoff} summarised`,
      );
    }
    return result;
  } catch (err) {
    console.error("[retention] pass failed", err);
    return null;
  } finally {
    running = false;
  }
}
