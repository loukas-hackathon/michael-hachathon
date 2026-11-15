import { learntAbout } from "../insights/service";
import type { Learnt, RealtimeTrigger } from "./realtime";

// The seam to what Michael has learnt (apps/api/src/insights): "late phone costs you 14 points of
// sleep score, held 9 of 11 times". `reason` goes on the nudge's reason line as it is, `line` (a
// whole sentence of at most 6 words, number first) goes into the nudge when it fits. It reads the
// study the process already keeps for the user and never starts one, so asking every minute costs
// nothing; until a study exists the two real time nudges speak without it.

/** What Michael has learnt about one trigger for the current user, or null. Never throws. */
export async function learntFor(trigger: RealtimeTrigger): Promise<Learnt | null> {
  try {
    return learntAbout(trigger);
  } catch {
    return null;
  }
}
