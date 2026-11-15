import "server-only";
import { watchTimelinePath } from "@/components/today/watch-line";
import { getLatestBrief } from "./analysis";
import { get } from "./api";
import { USE_MOCKS } from "./mode";
import { getMoment, momentKindAt } from "./moments";

/**
 * Starts the requests of the rows that stream in under Today's score (moment, watch, brief) at the
 * same time as the score itself, instead of after it (#221). Next memoises identical GETs within a
 * render and getLatestBrief is React cached, so the rows pick up these answers rather than asking
 * again. Errors are left for the rows to handle; nothing here throws.
 */
export function preloadTodaySections(variant?: string): void {
  if (variant || USE_MOCKS) return;
  const kind = momentKindAt(new Date().toISOString());
  if (kind) getMoment(kind, false, { cached: true }).catch(() => {});
  get(watchTimelinePath()).catch(() => {});
  void getLatestBrief();
}
