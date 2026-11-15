import { MICHAEL_VOICE, voiceDuration } from "@michael/shared";
import { type AskModel, acceptable, askClaude, lineFrom } from "../moments/phrase";
import type { ReviewCore } from "./review";

// Your week (#376): the model may only rewrite the lesson in Michael's voice. It sees the review's
// facts, never raw events, and its line is used only if it passes the moments' checks (a finished
// reply, a full stop, no semicolon, the voice rules, and every number in it appears in the facts);
// otherwise the template lesson stands.

const SYSTEM = `${MICHAEL_VOICE}

Task: write the ONE lesson of the user's week, at most 2 short sentences and 30 words, for their Sunday review. Name the one thing that cost the most or the goal furthest behind, and what to do about it next week. Use only numbers and names that appear in the facts, durations written as they are there. End with a full stop. No semicolons. No quotes. Reply with the lesson only.`;

/** Facts the model may use, all from the review. No dates: their digits would pass the number guard. */
export function reviewFacts(r: ReviewCore): string {
  const s = r.score;
  const d = voiceDuration;
  const lines = [
    `Template lesson: ${r.lesson}`,
    `The week has ${r.complete ? "ended" : "nearly ended"}.`,
    s.pct === null
      ? "No goal time elapsed this week."
      : `Score ${s.pct}%: ${d(s.spent_minutes)} held of ${d(s.elapsed_minutes)} planned so far, ${d(s.lost_minutes)} lost.`,
    ...(s.usual_pct === null ? [] : [`Usual week ${s.usual_pct}%.`]),
    ...(r.won_back_minutes > 0 ? [`Won back ${d(r.won_back_minutes)} against the usual loss rate.`] : []),
    ...r.goals.map((g) =>
      g.kind === "time"
        ? `Goal ${g.title}: ${d(g.done)} of ${d(g.budget)}, ${g.kept ? "kept" : `${d(g.short)} short`}.`
        : `Goal ${g.title}: ${g.done} of ${g.budget} sessions, ${g.kept ? "kept" : `${g.short} short`}.`,
    ),
    ...(r.thief
      ? [`Biggest thief: ${r.thief.what}, ${d(r.thief.minutes)}, ${r.thief.share_pct}% of the lost time.`]
      : []),
    ...(r.best_block
      ? [`Longest unbroken block: ${d(r.best_block.minutes)} on ${r.best_block.goal_title}.`]
      : []),
    ...r.records.flatMap((rec) => (rec.line ? [`Record: ${rec.line}`] : [])),
    ...(r.next_move ? [`Next week: ${r.next_move.title}.`] : []),
  ];
  return lines.join("\n");
}

// One model call per distinct set of facts; a cached line is checked again on the way out.
const cache = new Map<string, string>();
const CACHE_MAX = 200;

export async function phraseLesson(
  r: ReviewCore,
  cacheKey: string,
  ask: AskModel | null = askClaude(SYSTEM),
): Promise<{ lesson: string; phrased_by: "template" | "model" }> {
  const template = { lesson: r.lesson, phrased_by: "template" as const };
  if (!ask) return template;
  const facts = reviewFacts(r);
  const key = `${cacheKey}\n${facts}`;
  const cached = cache.get(key);
  if (cached !== undefined && acceptable(cached, facts)) return { lesson: cached, phrased_by: "model" };
  try {
    const line = lineFrom(await ask(facts), facts);
    if (!line) return template;
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, line);
    return { lesson: line, phrased_by: "model" };
  } catch (err) {
    console.warn("week: model phrasing failed, using the template", err);
    return template;
  }
}
