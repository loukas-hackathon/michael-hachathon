import { runAsUser } from "../context";
import { env } from "../env";
import { store } from "../store";
import { syncGoogleCalendar } from "./calendar-sync";
import { googleConfigured } from "./google";

/** Syncs every connected calendar once, one user at a time, each as that user. */
export async function syncAllCalendars(): Promise<void> {
  const users = await store.listConnectedUserIds("google_calendar");
  for (const userId of users) {
    await runAsUser(userId, async () => {
      try {
        await syncGoogleCalendar();
      } catch (err) {
        console.error(`calendar sync failed for ${userId}:`, err instanceof Error ? err.message : err);
      }
    });
  }
}

/** Background sync every CALENDAR_SYNC_MINUTES while the API runs. */
export function startCalendarSync(): void {
  if (!googleConfigured() || env.CALENDAR_SYNC_MINUTES <= 0) return;
  const every = env.CALENDAR_SYNC_MINUTES * 60_000;
  const run = () => syncAllCalendars().catch((err) => console.error("calendar sync", err));
  setTimeout(run, 30_000).unref();
  setInterval(run, every).unref();
}
