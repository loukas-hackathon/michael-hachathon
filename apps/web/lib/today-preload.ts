import "server-only";
import { watchTimelinePath } from "@/components/today/watch-line";
import { getLatestBrief } from "./analysis";
import { get, getGoals, getRecommendations, usingMocks } from "./api";
import { getMoment, momentKindAt } from "./moments";

/**
 * Starts the requests of the sections that stream in below Today's score (moment, watch,
 * suggestions, brief) at the same time as the score itself, instead of after it. Each loader is deduped per
 * render (React cache), so the sections pick up these answers rather than asking again.
 * Errors are left for the sections to handle; nothing here throws.
 */
export function preloadTodaySections(variant?: string): void {
  if (variant || usingMocks()) return;
  const kind = momentKindAt(new Date().toISOString());
  if (kind) getMoment(kind, false).catch(() => {});
  getRecommendations().catch(() => {});
  getGoals().catch(() => {});
  get(watchTimelinePath()).catch(() => {});
  void getLatestBrief();
}
