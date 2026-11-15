import {
  DEMO_RECOMMENDATION_IDS,
  demoRecommendations,
  mockRecommendations,
  type Recommendation,
} from "@michael/shared";
import type { Store } from "../store";

// What the demo account (the stage) must never show, and what every seed takes out again (#330).
//
// The first seed script wrote the sample day's brief and suggestions into the demo account: a run
// "Written by gemini (mock)" about a recovery colour no source reports, "Add a protein snack before
// the gym" for a weight goal no screen shows, and two hand written suggestions the demo week does
// not back up (training "two sessions behind" while Goals shows it on pace, and an 11:00 sync that
// is not in the calendar). They made Michael look generic. A real brief comes from a real analysis
// run; a real suggestion from the week's own numbers (the drive suggestion in demo/sync.ts).

/** A sample run says so in its model name ("gemini (mock)"). No real run does. */
export const SAMPLE_MODEL_MARKER = "(mock)";

const [FOCUS_ID, RUN_ID, SYNC_ID] = DEMO_RECOMMENDATION_IDS;

/** The sample day's suggestions and the two demo suggestions the week does not back up. */
export const RETIRED_RECOMMENDATION_IDS: string[] = [
  ...mockRecommendations.map((r) => r.id),
  RUN_ID,
  SYNC_ID,
];

/** "Weight to 90 kg": no screen showed it and nothing in the week measures it. */
export const RETIRED_GOAL_IDS = ["10000000-0000-4000-8000-000000000004"];

/**
 * The hand written suggestion the demo week keeps: the outreach focus block, the card behind
 * "Do it, then Undo" (docs/pitch.md, e2e/tests/demo-path.spec.ts). It holds on the week: the
 * company's blocks are morning outreach and its budget has time left.
 */
export function demoWeekRecommendations(now: Date = new Date()): Recommendation[] {
  return demoRecommendations(now).filter((r) => r.id === FOCUS_ID);
}

/** Takes the retired sample rows out of the caller's account. Safe to run on every seed. */
export async function removeRetiredSamples(store: Store): Promise<void> {
  await store.removeSampleAnalysis(SAMPLE_MODEL_MARKER, RETIRED_RECOMMENDATION_IDS);
  for (const id of RETIRED_GOAL_IDS) await store.deleteGoal(id);
}
