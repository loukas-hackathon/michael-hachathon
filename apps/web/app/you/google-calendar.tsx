import { ActionButton } from "@/components/action-button";
import { CalendarGoals } from "@/components/goals/calendar-goals";
import { getGoalSuggestions } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { getGoogleCalendar } from "@/lib/integrations";
import { disconnectCalendar, syncCalendar } from "./google-calendar-actions";

// Google Calendar on the You screen: one tap to connect (the user picks which Google account),
// then "Connected as" with Sync now and Disconnect. Plain <a> for connect, so nothing prefetches it.
export async function GoogleCalendarRow() {
  const cal = await getGoogleCalendar();
  const connected = cal?.status === "connected";

  if (!connected) {
    return (
      <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        <span className="flex min-w-0 flex-col">
          <span className="text-body">Google Calendar</span>
          <span className="text-footnote text-label-2">
            {cal?.status === "error"
              ? (cal.error ?? "I lost access. Connect again.")
              : "Your plan for the day. I only move your own blocks."}
          </span>
        </span>
        <a
          href="/integrations/google/connect"
          className="hit press flex h-9 shrink-0 items-center rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
        >
          Connect
        </a>
      </div>
    );
  }

  // Right after connecting, Michael reads the user's habits off the calendar and offers them as goals.
  const suggestions = await getGoalSuggestions();
  return (
    <div className="flex min-h-14 flex-col gap-2 px-4 py-2">
      <span className="flex flex-col">
        <span className="text-body">Google Calendar</span>
        <span className="text-footnote text-label-2 tnum">
          {cal.account ? `Connected as ${cal.account}.` : "Connected."}
          {cal.last_sync_at ? ` Synced at ${formatTime(cal.last_sync_at)}.` : ""}
          {cal.error ? ` Last sync failed: ${cal.error}` : ""}
        </span>
      </span>
      <span className="flex items-start gap-4">
        <ActionButton
          action={syncCalendar}
          label="Sync now"
          pendingLabel="Syncing"
          className="hit press h-9 min-w-[4.5rem] text-left text-subhead font-semibold text-tint-text"
        />
        <ActionButton
          action={disconnectCalendar}
          label="Disconnect"
          pendingLabel="Disconnecting"
          className="hit press h-9 text-left text-subhead font-semibold text-label"
        />
      </span>
      {suggestions.length > 0 ? <CalendarGoals initial={suggestions} className="pb-2" /> : null}
    </div>
  );
}
