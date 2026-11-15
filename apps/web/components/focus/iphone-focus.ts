import { FOCUS_SHORTCUT_OFF, focusShortcutInput } from "@michael/shared/focus-shortcut";
import { isStandalone } from "@/components/standalone";
import { focusShortcutAdded, focusShortcutRunLink } from "@/lib/dnd";

// Focus now turns on the iPhone's own Focus (#534). No page may set a Focus, the Michael Focus
// shortcut can: after a tap that started, extended or ended a session, the page runs it with the
// session's end time (or "off"), Shortcuts sets the Focus and comes back. Only on an iPhone that
// has added the shortcut (remembered on the device by the set up step); never without a tap, so
// a session Michael started from a goal block leaves the phone alone.

/** True on an iPhone (iPadOS reports itself as a Mac and is left out). */
export function onIphone(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPod/.test(navigator.userAgent);
}

/** The phone can follow the session: an iPhone with Michael Focus added. */
export function iphoneFocusReady(): boolean {
  return onIphone() && focusShortcutAdded.get();
}

/**
 * Runs Michael Focus until `endAt`, or off. Call only from a user's tap. Back to this page in
 * Safari; the installed app cannot be reopened by an https link, so there iOS's own "Michael"
 * back button returns.
 */
export function runIphoneFocus(endAt: string | null): boolean {
  if (!iphoneFocusReady()) return false;
  const input =
    endAt === null
      ? FOCUS_SHORTCUT_OFF
      : focusShortcutInput(endAt, Intl.DateTimeFormat().resolvedOptions().timeZone);
  window.location.href = focusShortcutRunLink(input, isStandalone() ? undefined : window.location.href);
  return true;
}
