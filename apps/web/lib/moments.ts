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

export async function getMoment(kind: MomentKind, sample: boolean): Promise<Moment> {
  if (sample) return kind === "morning" ? sampleMorningMoment : sampleEveningMoment;
  return get<Moment>(`/v1/moments/${kind}`);
}
