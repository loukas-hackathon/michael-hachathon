import type { GoalArea, GoalCategory } from "@michael/shared";

/**
 * The goals Goals offers in one tap before there are any (#478): one per area, each with a weekly
 * budget anyone can hold. The same titles and calendar words as onboarding's starters.
 */
export type StarterGoal = {
  key: string;
  title: string;
  area: GoalArea;
  category: GoalCategory;
  minutes: number;
  target: Record<string, unknown>;
};

export const STARTER_GOALS: StarterGoal[] = [
  {
    key: "deep-work",
    title: "Deep work",
    area: "business",
    category: "work",
    minutes: 10 * 60,
    target: { calendar_titles: ["Deep work", "Focus", "Study"] },
  },
  {
    key: "training",
    title: "Training",
    area: "health",
    category: "gym",
    minutes: 4 * 60,
    target: { calendar_titles: ["Gym", "Run", "Swim", "Training"] },
  },
  {
    key: "yourself",
    title: "Time for yourself",
    area: "personal",
    category: "personal",
    minutes: 3 * 60,
    target: { kind: "time", label: "fun" },
  },
];
