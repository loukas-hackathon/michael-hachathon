/**
 * How tall the room under the status bar must be in the installed app, in px, or null to keep
 * env(safe-area-inset-top). Plain JavaScript in a string because it runs inline before the first
 * paint (components/safe-top.tsx); the test evaluates the same string.
 *
 * Seen on real iPhones (#448, #452 follow up):
 * - The app fills the screen and env() says 0: the content sits under the clock. Use the iPhone's
 *   status bar height.
 * - The page already starts below the status bar (innerHeight shorter than the screen) while env()
 *   still says 47: padding by env() again drew an empty band under the status bar. Use 0; the cover
 *   in globals.css reaches above the page, so nothing scrolls visibly under the clock.
 * - Otherwise env() is right. A browser tab and landscape are never touched.
 */
export const SAFE_TOP_FN = `function safeTopFor(s) {
  if (!s.standalone || s.innerWidth > s.innerHeight) return null;
  if (s.innerHeight < s.screenHeight - 1) return 0;
  if (s.env > 0) return null;
  var t = { 667: 20, 736: 20, 812: 47, 844: 47, 852: 59, 874: 62, 896: 48, 926: 47, 932: 59, 956: 62 };
  return t[s.screenHeight] || 47;
}`;

export type SafeTopState = {
  standalone: boolean;
  env: number;
  innerHeight: number;
  innerWidth: number;
  screenHeight: number;
};
