import "server-only";
import type { Moment, MomentKind } from "@michael/shared";
import { get } from "./api";
import { sampleEveningMoment, sampleMorningMoment } from "./sample/moments";

// Morning and Evening moments (GET /v1/moments/:kind). Sample data while USE_MOCKS is on.
const USE_MOCKS = process.env.USE_MOCKS !== "false";

export async function getMoment(kind: MomentKind): Promise<Moment> {
  if (USE_MOCKS) return kind === "morning" ? sampleMorningMoment : sampleEveningMoment;
  return get<Moment>(`/v1/moments/${kind}`);
}
