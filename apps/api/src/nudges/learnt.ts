import type { Learnt, RealtimeTrigger } from "./realtime";

// The seam to what Michael has learnt (apps/api/src/insights, in the making on another branch):
// "late phone costs you 14 points of sleep score, held 9 of 11 times". When that module exports its
// lookup, call it here and map it to a `Learnt`: `reason` goes on the nudge's reason line as it is,
// `line` (a whole sentence of at most 6 words, number first) goes into the nudge when it fits.
// Until then the two real time nudges speak without it.

/** What Michael has learnt about one trigger for the current user, or null. Never throws. */
export async function learntFor(_trigger: RealtimeTrigger): Promise<Learnt | null> {
  return null;
}
