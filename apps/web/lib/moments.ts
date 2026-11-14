import "server-only";
import type { Moment, MomentKind } from "@michael/shared";
import { get } from "./api";
import type { DayView } from "./day";
import { sampleEveningMoment, sampleMorningMoment } from "./sample/moments";

// Morning and Evening moments (GET /v1/moments/:kind). Sample days (mocks and ?demo previews) get
// the sample moment; the live day gets the real one.

const hourFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Athens",
});

/** Morning until 12:00, evening from 18:00, Athens time; nothing in between. */
export function momentKindAt(iso: string): MomentKind | null {
  const h = Number(hourFmt.format(new Date(iso)));
  if (h < 12) return "morning";
  if (h >= 18) return "evening";
  return null;
}

/** Which moment Today shows: the preview's own moment for a sample day, the clock for a live one. */
export function momentKindFor(day: Pick<DayView, "sample" | "moment" | "now">): MomentKind | null {
  if (day.sample) return day.moment === "today" ? null : day.moment;
  return momentKindAt(day.now);
}

export async function getMoment(kind: MomentKind, sample: boolean): Promise<Moment> {
  if (sample) return kind === "morning" ? sampleMorningMoment : sampleEveningMoment;
  return get<Moment>(`/v1/moments/${kind}`);
}
