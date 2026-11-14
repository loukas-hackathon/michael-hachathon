import { AppCategory, type Goal, goalArea } from "@michael/shared";

// THE one place that says what a minute of attention means inside a goal's planned block. The
// score and the patterns' calendar mode both read it, so the two numbers agree.
//
// Every app and site has a category (packages/shared/src/categories.ts), and a category has a
// role wherever it shows up:
//
//   work        work, ai
//   distractor  communication, social, video, news, shopping, travel
//   neutral     music, system, other (they neither make nor break anything)
//
// Inside a block of a goal, attention is one of three things:
//
//   on       It IS the goal's work: spent, and proof that the goal was worked on.
//              - a category the goal lists in `target.work_categories`, whatever the goal
//                (["communication"] on a sales goal: the mail and the messages are the work);
//              - a work category inside a block of a business goal.
//   off      Not the goal: lost in the score, a disruption in the patterns.
//              - any distractor the goal does not list;
//              - a work category inside a block of a health or personal goal that does not list
//                it. A sales call during the gym session is not training, and a laptop open on a
//                night out is not the night out.
//   neutral  Neither: music, the system, anything uncategorised. Spent, proving nothing.

export type Role = "work" | "distractor" | "neutral";
export type Purpose = "on" | "off" | "neutral";

const WORK: ReadonlySet<AppCategory> = new Set(["work", "ai"]);
const DISTRACTOR: ReadonlySet<AppCategory> = new Set([
  "communication",
  "social",
  "video",
  "news",
  "shopping",
  "travel",
]);

/** Music, the system itself and anything unknown are neutral: they neither make nor break focus. */
export const roleOf = (category: AppCategory): Role =>
  WORK.has(category) ? "work" : DISTRACTOR.has(category) ? "distractor" : "neutral";

/** The categories a goal lists in `target.work_categories`. Anything that is not a category is skipped. */
export function workCategories(goal: Goal): AppCategory[] {
  const list = goal.target?.work_categories;
  if (!Array.isArray(list)) return [];
  return list.flatMap((c) => {
    const category = AppCategory.safeParse(c);
    return category.success ? [category.data] : [];
  });
}

/** A goal whose planned blocks are work: the business category (and its older name, `work`). */
export const isBusinessGoal = (goal: Goal) => goalArea(goal.category) === "business";

/**
 * A goal a recorded workout can prove: a health goal that is not one of the older `rest` or
 * `food` goals.
 */
export const isTrainingGoal = (goal: Goal) => goal.category === "health" || goal.category === "gym";

/** For one goal, what attention in a category means inside its planned blocks. The rule is at the top. */
export function purposeFor(goal: Goal): (category: AppCategory) => Purpose {
  // The goal's list is read once: this runs over thousands of segments.
  const listed = new Set(workCategories(goal));
  const business = isBusinessGoal(goal);
  return (category) => {
    if (listed.has(category)) return "on";
    const role = roleOf(category);
    if (role === "neutral") return "neutral";
    if (role === "distractor") return "off";
    return business ? "on" : "off";
  };
}

/** What attention in `category` means inside a planned block of `goal`. */
export const purposeOf = (goal: Goal, category: AppCategory): Purpose => purposeFor(goal)(category);
