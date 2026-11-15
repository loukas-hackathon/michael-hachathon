import Anthropic from "@anthropic-ai/sdk";
import { MICHAEL_VOICE, voiceProblems } from "@michael/shared";
import { env } from "../env";
import { lastTimeLine, type MomentCore, templateHeadline } from "./compute";

// The model only rewrites the headline in Michael's voice. It sees the computed summary, never raw
// events, and its line is used only if it passes the checks below; otherwise the template stands.

const TIMEOUT_MS = 8000;
// The model thinks before it writes, and thinking counts against the cap: 300 tokens cut the line
// in the middle ("guard Rhefuel from 09:00 to 10:"). The cap is only a ceiling; the line is short.
const MAX_TOKENS = 16000;

const SYSTEM = `${MICHAEL_VOICE}

Task: write ONE sentence, at most 25 words, for the user's moment card. Use only numbers and times that appear in the facts. End it with a full stop. No semicolons. No quotes. Reply with the sentence only.`;

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
      ? [
          `At risk: ${m.at_risk.title}, usual loss ${m.at_risk.expected_lost_minutes} minutes over ${m.at_risk.history_days} days with a block in those hours.`,
          ...[lastTimeLine(m.at_risk, m.day)].flatMap((line) => (line ? [`Last time: ${line}`] : [])),
        ]
      : []),
    ...m.suggestions.map((s) => `Suggestion: ${s.title}. ${s.rationale}`),
    ...(m.lesson ? [`Lesson: ${m.lesson}`] : []),
    ...(m.first_move ? [`Tomorrow: ${m.first_move.title}. ${m.first_move.rationale}`] : []),
  ];
  return lines.join("\n");
}

/**
 * True when a model line is a finished line, keeps the voice rules and invents no number. Finished
 * means it ends with a full stop or a question mark: a reply cut short ends anywhere.
 */
export function acceptable(line: string, facts: string): boolean {
  if (line.length < 10 || line.length > 220 || line.includes("\n")) return false;
  if (!/[.?]$/.test(line) || line.includes(";")) return false;
  if (voiceProblems(line).length > 0) return false;
  const known = new Set(facts.match(/\d+/g) ?? []);
  return (line.match(/\d+/g) ?? []).every((n) => known.has(n));
}

/** What the check needs from a model reply: why it stopped and what it wrote. */
export interface ModelReply {
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

/** Asks the model for the line. The tests pass their own. */
export type AskModel = (facts: string) => Promise<ModelReply>;

/**
 * The line of a model reply, or null when the reply cannot be used: only a reply the model ended
 * by itself (`end_turn`) counts. One stopped by the token cap, a refusal or anything else is
 * unfinished, however complete its last sentence looks.
 */
export function lineFrom(reply: ModelReply, facts: string): string | null {
  if (reply.stop_reason !== "end_turn") return null;
  const line = reply.content
    .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
    .join("")
    .trim()
    .replace(/^["']|["']$/g, "");
  return acceptable(line, facts) ? line : null;
}

// One model call per distinct set of facts: reloading the card does not call the model again.
// A cached line is checked again on the way out, so a line stored under older rules (a half line
// from a reply cut by the old cap) is dropped and never served.
const cache = new Map<string, string>();
const CACHE_MAX = 500;
let client: Anthropic | null = null;

/** Claude, when a key is set. */
function askClaude(): AskModel | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return (facts) => {
    client ??= new Anthropic({ apiKey });
    return client.messages.create(
      {
        model: env.ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        // A single short line: latency matters more than depth here.
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{ role: "user", content: facts }],
      },
      { timeout: TIMEOUT_MS, maxRetries: 0 },
    );
  };
}

export async function phraseHeadline(
  m: MomentCore,
  cacheKey: string,
  ask: AskModel | null = askClaude(),
): Promise<{ headline: string; phrased_by: "template" | "model" }> {
  const template = { headline: templateHeadline(m), phrased_by: "template" as const };
  if (!ask) return template;
  const facts = factsFor(m);
  const key = `${cacheKey}\n${facts}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    if (acceptable(cached, facts)) return { headline: cached, phrased_by: "model" };
    cache.delete(key);
  }
  try {
    const line = lineFrom(await ask(facts), facts);
    if (!line) return template;
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, line);
    return { headline: line, phrased_by: "model" };
  } catch (err) {
    console.warn("moments: model phrasing failed, using the template", err);
    return template;
  }
}

/** For the tests: put a line in the cache as an older deploy could have. */
export function cacheLineForTest(m: MomentCore, cacheKey: string, line: string): void {
  cache.set(`${cacheKey}\n${factsFor(m)}`, line);
}
