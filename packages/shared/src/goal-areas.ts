import type { GoalArea, GoalCategory } from "./schemas";

// Zod free, so client components (onboarding) can group goals without shipping every schema.

const GOAL_AREA: Record<GoalCategory, GoalArea> = {
  business: "business",
  health: "health",
  personal: "personal",
  work: "business",
  gym: "health",
  rest: "health",
  food: "health",
};

/** The one of the three categories a goal category belongs to, for any of the seven values. */
export const goalArea = (category: GoalCategory): GoalArea => GOAL_AREA[category];
