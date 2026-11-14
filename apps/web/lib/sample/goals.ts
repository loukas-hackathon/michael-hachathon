import { mockScore } from "@michael/shared";
import type { GoalsView } from "../goals-view";
import { sampleExplain } from "../score-explain";

// SAMPLE DATA, not the user's: the demo user's real goals (the company, university, 70.3 training,
// sleep) with a made up week, on the same Wednesday 15:20 as the sample day. Replaced once the
// score endpoint carries per goal, per day minutes.

export const sampleGoals: GoalsView = {
  sample: true,
  weekStart: "2026-11-09T00:00:00+02:00",
  now: "2026-11-11T15:20:00+02:00",
  freeMinutesLeft: 720,
  explain: sampleExplain(mockScore),
  goals: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      title: "The company",
      category: "business",
      budgetMinutes: 900,
      spentMinutes: 460,
      unverifiedMinutes: 120,
      plannedMinutes: 840,
      openBlocks: 3,
      daily: [170, 160, 130, null, null, null, null],
    },
    {
      id: "10000000-0000-4000-8000-000000000005",
      title: "University",
      category: "business",
      budgetMinutes: 360,
      spentMinutes: 80,
      unverifiedMinutes: 0,
      plannedMinutes: 300,
      openBlocks: 2,
      daily: [20, 0, 60, null, null, null, null],
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      title: "70.3 training",
      category: "health",
      budgetMinutes: 540,
      spentMinutes: 290,
      unverifiedMinutes: 95,
      plannedMinutes: 540,
      openBlocks: 2,
      daily: [95, 75, 120, null, null, null, null],
    },
  ],
  sleep: { goalMinutes: 450, nightly: [412, 455, 400, null, null, null, null] },
  target: {
    status: "accepted",
    median: 62,
    overall: 65,
    areas: { business: 70, health: 62, personal: 55 },
    floors: { business: 50, health: 50, personal: 50 },
    setBy: "michael",
    reason: null,
  },
  baseline: null,
  balance: {
    overall: 64,
    target: 65,
    areas: { business: 91, health: 63, personal: 12 },
    floors: { business: 50, health: 50, personal: 50 },
  },
};

/** Monday: Michael's proposal for the week, waiting for the user. */
export const sampleGoalsMonday: GoalsView = {
  ...sampleGoals,
  now: "2026-11-09T08:10:00+02:00",
  freeMinutesLeft: null,
  explain: null,
  target: {
    status: "proposed",
    median: 62,
    overall: 65,
    areas: { business: 70, health: 62, personal: 55 },
    floors: { business: 50, health: 50, personal: 50 },
    setBy: "michael",
    reason: null,
  },
  balance: null,
  goals: sampleGoals.goals.map((g) => ({
    ...g,
    spentMinutes: 0,
    unverifiedMinutes: 0,
    daily: [0, null, null, null, null, null, null],
  })),
};

/** The first week: not enough history for a target yet. */
export const sampleGoalsBaseline: GoalsView = {
  ...sampleGoalsMonday,
  target: null,
  baseline: { weeksDone: 1, weeksNeeded: 2 },
};

export const sampleGoalsEmpty: GoalsView = { ...sampleGoals, goals: [], sleep: null };
