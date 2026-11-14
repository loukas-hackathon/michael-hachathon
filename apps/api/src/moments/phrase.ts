import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { type MomentCore, templateHeadline } from "./compute";

// The model only rewrites the headline in Michael's voice. It sees the computed summary, never raw
// events, and its line is used only if it passes the checks below; otherwise the template stands.

const TIMEOUT_MS = 8000;

const SYSTEM = [
  "You are Michael, a firm sports coach for the whole day. Write ONE sentence, at most 25 words,",
  "for the user's moment card. Use only numbers and times that appear in the facts. British spelling,",
  "24 hour time, speak to the user as you, refer to yourself as I. No dashes, no emoji, no",
  "exclamation marks, no quotes. Never say productivity or wellness. Reply with the sentence only.",
].join(" ");

/** Facts the model may use: the template line, the totals and the moves, all from the core. */
export function factsFor(m: MomentCore): string {
  const lines = [
    `Kind: ${m.kind}. Template line: ${templateHeadline(m)}`,
    `Goal time today: ${m.totals.planned_minutes} minutes planned, ${m.totals.spent_minutes} held, ${m.totals.lost_minutes} lost, ${m.totals.won_back_minutes} won back.`,
    ...m.goals.map(
      (g) =>
        `Goal ${g.title}: ${g.spent_week_minutes} of ${g.budget_minutes ?? "no"} budget minutes spent this week, ${g.planned_ahead_minutes} planned ahead.`,
    ),
    ...(m.at_risk
      ? [`At risk: ${m.at_risk.title}, usual loss ${m.at_risk.expected_lost_minutes} minutes.`]
      : []),
    ...m.suggestions.map((s) => `Suggestion: ${s.title}. ${s.rationale}`),
    ...(m.lesson ? [`Lesson: ${m.lesson}`] : []),
    ...(m.first_move ? [`Tomorrow: ${m.first_move.title}. ${m.first_move.rationale}`] : []),
  ];
  return lines.join("\n");
}

/** True when a model line keeps the voice rules and invents no number. */
export function acceptable(line: string, facts: string): boolean {
  if (line.length < 10 || line.length > 220 || line.includes("\n")) return false;
  if (/[‐-―]|\s-\s|!|\p{Extended_Pictographic}/u.test(line)) return false;
  if (/productivity|wellness/i.test(line)) return false;
  const known = new Set(facts.match(/\d+/g) ?? []);
  return (line.match(/\d+/g) ?? []).every((n) => known.has(n));
}

// One model call per distinct set of facts: reloading the card does not call the model again.
const cache = new Map<string, string>();
const CACHE_MAX = 500;
let client: Anthropic | null = null;

export async function phraseHeadline(
  m: MomentCore,
  cacheKey: string,
): Promise<{ headline: string; phrased_by: "template" | "model" }> {
  const template = { headline: templateHeadline(m), phrased_by: "template" as const };
  if (!env.ANTHROPIC_API_KEY) return template;
  const facts = factsFor(m);
  const key = `${cacheKey}\n${facts}`;
  const cached = cache.get(key);
  if (cached) return { headline: cached, phrased_by: "model" };
  try {
    client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const res = await client.messages.create(
      {
        model: env.ANTHROPIC_MODEL,
        max_tokens: 300,
        // A single short line: latency matters more than depth here.
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{ role: "user", content: facts }],
      },
      { timeout: TIMEOUT_MS, maxRetries: 0 },
    );
    if (res.stop_reason === "refusal") return template;
    const line = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!acceptable(line, facts)) return template;
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, line);
    return { headline: line, phrased_by: "model" };
  } catch (err) {
    console.warn("moments: model phrasing failed, using the template", err);
    return template;
  }
}
