import type { Recommendation } from "@michael/shared";
import { currentUserId } from "../context";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { Zone } from "../patterns/time";
import { phoneCadenceFor } from "../routes/patterns";
import { store } from "../store";
import { planDndWindow } from "./window";

// Where the busiest window offer is made (#432): with the day's other offers, when Today reads the
// score (checklist/offers.ts serialises it per user, so two reads never store it twice). The phone
// cadence is the same memoised read Today already makes; nothing new is read when an offer for the
// next window exists, and it looks at most once every half hour per user. Off the record: no offer.

/** One look every half hour per user is plenty: the busiest hours move over days, not minutes. */
export const LOOK_EVERY_MS = 30 * 60_000;
const lastLook = new Map<string, number>();

/** Tests only. */
export const resetDndWindowLooks = () => lastLook.clear();

export async function offerDndWindow(now = Date.now()): Promise<Recommendation[]> {
  const user = currentUserId();
  const last = lastLook.get(user);
  if (last !== undefined && Math.abs(now - last) < LOOK_EVERY_MS) return [];
  lastLook.set(user, now);
  const [rules, existing] = await Promise.all([store.privacyRules(), store.listRecommendations()]);
  if (rules.offTheRecord) return [];
  const report = await phoneCadenceFor();
  const offer = planDndWindow({
    cadence: report.phone_cadence.data,
    now,
    zone: new Zone(DEFAULT_TIMEZONE),
    existing,
  });
  if (!offer) return [];
  return [await store.createRecommendation(offer)];
}
