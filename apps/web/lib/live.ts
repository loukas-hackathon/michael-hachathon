import "server-only";
import type { TimelineResponse } from "@michael/shared";
import { get } from "./api";
import { USE_MOCKS } from "./mode";

/**
 * A short fingerprint of what Today and Timeline are drawn from: the last 24 hours of events and
 * today's nudges. The browser polls it (GET /live) and refreshes the screen only when it changes,
 * so a quiet day costs one small request a minute and no re-render.
 */
export async function getLiveStamp(): Promise<string> {
  if (USE_MOCKS) return "mock";
  const [timeline, nudges] = await Promise.all([
    get<TimelineResponse>("/v1/timeline"),
    get<{ nudges: { id: string }[] }>("/v1/nudges").catch(() => ({ nudges: [] })),
  ]);
  let latest = "";
  for (const e of timeline.events) {
    if (e.created_at > latest) latest = e.created_at;
    if (e.end_at && e.end_at > latest) latest = e.end_at;
  }
  return [timeline.events.length, latest, nudges.nudges.length, nudges.nudges.at(-1)?.id ?? ""].join("|");
}
