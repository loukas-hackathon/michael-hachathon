import { FOCUS_SHORTCUT_NAME, FOCUS_SHORTCUT_OFF, FOCUS_SHORTCUT_PATH } from "@michael/shared/focus-shortcut";

// Do Not Disturb, asked then done (#447): pure helpers for the hand over to the Michael Focus
// shortcut (scripts/shortcut/build.mjs). No app or page may set a Focus; a shortcut can, so the
// page runs it by name with the time it should end.

/** The signed shortcut this app serves (public/MichaelFocus.shortcut, made by `pnpm shortcut:focus`). */
export const FOCUS_SHORTCUT_FILE = FOCUS_SHORTCUT_PATH;

/** The iCloud link of Michael Focus (public, shared from Loukas' iPhone, 15 Nov). */
export const FOCUS_SHORTCUT_ICLOUD = "https://www.icloud.com/shortcuts/76e297e86ff742dfb3446679fb46932d";

/**
 * Where "Add Michael Focus" goes: MICHAEL_FOCUS_SHORTCUT_URL if set, else the iCloud link above (it
 * opens Shortcuts on Add Shortcut, no browser). Our own file is the fallback. Server only.
 */
export const focusShortcutUrl = () => process.env.MICHAEL_FOCUS_SHORTCUT_URL || FOCUS_SHORTCUT_ICLOUD;

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
