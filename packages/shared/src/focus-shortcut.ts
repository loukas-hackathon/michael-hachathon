// The Michael Focus shortcut (#447): its name, its file and what it is run with. No zod here, so
// the web app's client code can import it without the schemas (`@michael/shared/focus-shortcut`).

/** The signed shortcut that sets the Focus (scripts/shortcut/build.mjs), by the name iOS gives it. */
export const FOCUS_SHORTCUT_NAME = "Michael Focus";
/**
 * Where the web app serves the signed file. No space in the address; the download itself is named
 * "Michael Focus.shortcut" (apps/web/next.config.ts), because iOS names a shortcut after its file.
 */
export const FOCUS_SHORTCUT_PATH = "/MichaelFocus.shortcut";
export const FOCUS_SHORTCUT_DOWNLOAD = `${FOCUS_SHORTCUT_NAME}.shortcut`;
/** What the shortcut is run with to switch Do Not Disturb off, and to prove it is installed. */
export const FOCUS_SHORTCUT_OFF = "off";
export const FOCUS_SHORTCUT_CHECK = "check";

/**
 * The text the shortcut reads as the time to end: "2026-11-17 14:00", the wall clock of the
 * device that runs it (a phone and a Mac in the same place agree).
 */
export function focusShortcutInput(until: string, timeZone = "Europe/Athens"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(until));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
