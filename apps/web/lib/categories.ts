import type { GoalCategory } from "@michael/shared";

// Goals live in three categories (#131): business, health, personal. Until the contract switches,
// the old values stay readable: work is business; gym, rest and food are health.

export type Category = "business" | "health" | "personal";
export const CATEGORIES: Category[] = ["business", "health", "personal"];
export const CATEGORY_TITLE: Record<Category, string> = {
  business: "Business",
  health: "Health",
  personal: "Personal",
};

export function categoryOf(c: GoalCategory | string): Category {
  if (c === "business" || c === "work") return "business";
  if (c === "personal") return "personal";
  return "health";
}
