import type { GoalsView } from "../goals-view";

// SAMPLE DATA, not the user's: the demo user's real goals (the company, university, 70.3 training,
// sleep) with a made up week, on the same Wednesday 15:20 as the sample day. Replaced once the
// score endpoint carries per goal, per day minutes.

export const sampleGoals: GoalsView = {
  sample: true,
  weekStart: "2026-11-09T00:00:00+02:00",
  now: "2026-11-11T15:20:00+02:00",
  freeMinutesLeft: 720,
  goals: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      title: "The company",
      budgetMinutes: 900,
      spentMinutes: 460,
      daily: [170, 160, 130, null, null, null, null],
    },
    {
      id: "10000000-0000-4000-8000-000000000005",
      title: "University",
      budgetMinutes: 360,
      spentMinutes: 80,
      daily: [20, 0, 60, null, null, null, null],
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      title: "70.3 training",
      budgetMinutes: 540,
      spentMinutes: 290,
      daily: [95, 75, 120, null, null, null, null],
    },
  ],
  sleep: { goalMinutes: 450, nightly: [412, 455, 400, null, null, null, null] },
};

export const sampleGoalsEmpty: GoalsView = { ...sampleGoals, goals: [], sleep: null };
