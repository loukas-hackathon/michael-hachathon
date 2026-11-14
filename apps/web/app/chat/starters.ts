import type { Score } from "@michael/shared";
import { formatTime, hm } from "@/lib/format";

// Asked when the day gives nothing more specific. Short, in the user's words, about goals.
const FALLBACK = ["How is my day going?", "Where did my time go today?", "What should I do next?"];
const TRAINING = /gym|train|run|swim|bike|cycl|ride|lift|strength|70\.3|tri|marathon|sport|yoga/i;

/**
 * Three questions from the user's real day: the biggest loss inside a goal block, tomorrow's
 * training, and the goal furthest from its budget. Pure: the same score gives the same questions.
 */
export function startersFrom(score: Score | null): string[] {
  const out: string[] = [];
  if (score) {
    // The block that lost the most so far, with the time the loss started.
    const block = [...score.day.blocks].sort((a, b) => b.lost_minutes - a.lost_minutes)[0];
    if (block && block.lost_minutes >= 5) {
      const from = block.lost[0]?.start_at ?? block.start_at;
      out.push(`Why did I lose ${hm(block.lost_minutes)} at ${formatTime(from)}?`);
    }

    const timed = score.goals.filter((g) => g.kind === "time");
    if (timed.some((g) => g.area === "health" && (TRAINING.test(g.title) || g.category === "gym"))) {
      out.push("Plan tomorrow's training");
    }

    // Unplanned budget: what is neither spent nor in the calendar yet.
    const behind = timed
      .filter((g) => !(g.area === "health" && TRAINING.test(g.title)))
      .map((g) => ({ g, open: g.budget_minutes - g.spent_minutes - g.ahead_minutes }))
      .filter((x) => x.open >= 60)
      .sort((a, b) => b.open - a.open)[0];
    if (behind) out.push(`Book an hour for ${behind.g.title}`);
  }
  for (const q of FALLBACK) if (out.length < 3 && !out.includes(q)) out.push(q);
  return out.slice(0, 3);
}
