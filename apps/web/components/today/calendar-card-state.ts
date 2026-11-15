import type { Integration } from "@michael/shared";
import { calendarMissingLine, type GoalName } from "@/lib/today-lines";

// What the Today calendar card says (#307). Pure, so it is tested with node:test.

/**
 * The line and the button label, or null when the calendar is fine (or could not be read). Not
 * connected names what it costs the person's own goals (`goals`).
 */
export function calendarCardFor(
  cal: Integration | null,
  { emptyDay, goals = [] }: { emptyDay: boolean; goals?: GoalName[] },
): { line: string; cta: string } | null {
  // Could not read it: say nothing rather than guess.
  if (!cal) return null;
  if (cal.status === "error")
    return {
      line: "I lost access to your calendar. Connect it again so I can plan your day.",
      cta: "Reconnect",
    };
  if (cal.status === "connected")
    return cal.error
      ? { line: "Your calendar's last sync failed. Connect it again and I catch up.", cta: "Reconnect" }
      : null;
  // Not connected: on an empty day the Get started card already leads with it.
  return emptyDay ? null : { line: calendarMissingLine(goals), cta: "Connect" };
}
