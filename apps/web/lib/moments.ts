import "server-only";
import type { Moment, MomentKind } from "@michael/shared";
import { get } from "./api";
import { cardMomentAt, type DayView } from "./day";
import { sampleEveningMoment, sampleMorningMoment } from "./sample/moments";

// Morning and Evening moments (GET /v1/moments/:kind). Sample days (mocks and ?demo previews) get
// the sample moment; the live day gets the real one.

/** The moment card for a time, Athens time: the same hours as Today's title (lib/day.ts). */
export const momentKindAt = (iso: string): MomentKind | null => cardMomentAt(iso);

/** Which moment Today shows: the preview's own moment for a sample day, the clock for a live one. */
export function momentKindFor(day: Pick<DayView, "sample" | "moment" | "now">): MomentKind | null {
  if (day.sample) return day.moment === "today" ? null : day.moment;
  return momentKindAt(day.now);
}

/**
 * The moment. Today asks with `cached` (#378): the API never waits for the model then, and marks a
 * line still being written (`phrase_pending`); components/today/moment-phrase.tsx fetches it after.
 */
export async function getMoment(kind: MomentKind, sample: boolean, { cached = false } = {}): Promise<Moment> {
  if (sample) return kind === "morning" ? sampleMorningMoment : sampleEveningMoment;
  return get<Moment>(cached ? momentCachedPath(kind) : `/v1/moments/${kind}`);
}

/** The read Today preloads and the card makes: identical, so Next answers both with one request. */
export const momentCachedPath = (kind: MomentKind) => `/v1/moments/${kind}?phrase=cached`;
