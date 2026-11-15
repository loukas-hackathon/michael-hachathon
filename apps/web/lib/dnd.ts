import { FOCUS_SHORTCUT_NAME, FOCUS_SHORTCUT_OFF, FOCUS_SHORTCUT_PATH } from "@michael/shared/focus-shortcut";

// Do Not Disturb, asked then done (#447): pure helpers for the hand over to the Michael Focus
// shortcut (scripts/shortcut/build.mjs). No app or page may set a Focus; a shortcut can, so the
// page runs it by name with the time it should end.

/** The signed shortcut this app serves (public/Michael Focus.shortcut, made by `pnpm shortcut`). */
export const FOCUS_SHORTCUT_FILE = FOCUS_SHORTCUT_PATH;

/** Runs the installed shortcut with `input`: a date and time ("2026-11-17 14:00"), or "off". */
export const focusShortcutLink = (input: string) =>
  `shortcuts://run-shortcut?name=${encodeURIComponent(FOCUS_SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(input)}`;

export const focusShortcutOffLink = () => focusShortcutLink(FOCUS_SHORTCUT_OFF);

/** This browser has added the shortcut (kept on the device; the server never knows). */
const ADDED = "michael-focus-shortcut";
export const focusShortcutAdded = {
  get(): boolean {
    try {
      return localStorage.getItem(ADDED) === "1";
    } catch {
      return false;
    }
  },
  set() {
    try {
      localStorage.setItem(ADDED, "1");
    } catch {
      // Private mode: the page asks again next time, which is harmless.
    }
  },
};
