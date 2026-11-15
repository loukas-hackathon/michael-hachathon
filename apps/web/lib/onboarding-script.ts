import type { OnboardingTurn, OnboardingTurnResponse } from "@michael/shared";

// The onboarding talk's own script: what Michael asks when POST /v1/onboarding/turn cannot answer
// (not deployed yet, no model key, slow or down). The same three questions the talk always had,
// each with a short reaction to the last answer, never one the conversation already covered.

export type ScriptQuestion = { ask: string; hint: string };

export const SCRIPT_QUESTIONS: ScriptQuestion[] = [
  {
    ask: "What are you working towards right now?",
    hint: "Business, health, the people in your life. Whatever matters most.",
  },
  {
    ask: "What would make this a good week?",
    hint: "Say roughly how much time each thing needs.",
  },
  {
    ask: "Where does your time go that you wish it didn't?",
    hint: "The phone, meetings, late nights. It stays between us.",
  },
];

const REACTIONS = ["Got it.", "Good, that helps.", "Noted."];
const SKIPPED = "Fine, we'll leave that one.";
export const SCRIPT_DONE = "That's plenty. Here's what I heard.";
export const SCRIPT_DONE_EMPTY = "No problem. Let's pick from the usual instead.";

/** "That's it", "nothing else", "I'm done": the user has had enough of talking. */
const ENOUGH = /^(that'?s (it|all|everything)|nothing( else)?|done|i'?m done|enough)[.!]?$/i;

const answered = (t: OnboardingTurn) => t.role === "user" && !t.skipped && t.text.trim().length > 0;

/** Michael's next line from the script, given every turn so far. */
export function scriptTurn(turns: OnboardingTurn[]): OnboardingTurnResponse {
  const users = turns.filter((t) => t.role === "user");
  const said = turns.filter((t) => t.role === "michael").map((t) => t.text);
  const last = users.at(-1);
  const remaining = SCRIPT_QUESTIONS.filter(
    (q, i) => i >= users.length && !said.some((line) => line.includes(q.ask)),
  );
  const tired = last !== undefined && ENOUGH.test(last.text.trim());
  if (remaining.length === 0 || tired) {
    return {
      line: users.some(answered) ? SCRIPT_DONE : SCRIPT_DONE_EMPTY,
      done: true,
      from_calendar: false,
      source: "script",
    };
  }
  const next = remaining[0] as ScriptQuestion;
  const reaction = !last
    ? "Let's start with the big one."
    : last.skipped || !last.text.trim()
      ? SKIPPED
      : (REACTIONS[(users.length - 1) % REACTIONS.length] as string);
  return {
    line: `${reaction} ${next.ask} ${next.hint}`,
    done: false,
    from_calendar: false,
    source: "script",
  };
}

/**
 * His line without a hello or a "I'm Michael": the intro has just said both out loud, so hearing
 * them again sounds robotic. Left as it is when nothing else would remain.
 */
export function withoutGreeting(line: string): string {
  const sentences = line
    .replace(/([.?!])\s+/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const greeting =
    /^((hi|hello|hey)( there)?[,.]?\s*)?(i'?m|i am|this is) michael\b[^?]*[.!]?$|^(hi|hello|hey)( there)?[.!,]?$/i;
  let i = 0;
  while (i < sentences.length - 1 && greeting.test(sentences[i] as string)) i++;
  return i === 0 ? line.trim() : sentences.slice(i).join(" ");
}

/**
 * One of Michael's lines split for the screen: the reaction before his question, the question
 * itself (shown bold), and the hint after it. A line with no question is all `ask`.
 */
export function splitLine(line: string): { before: string; ask: string; after: string } {
  // A stop followed by a space ends a sentence. No lookbehind: older Safari cannot parse one.
  const sentences = line
    .replace(/([.?!])\s+/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const q = sentences.findLastIndex((s) => s.endsWith("?"));
  if (q < 0) return { before: "", ask: line.trim(), after: "" };
  // Two questions in a row ("Is that normal? What would you change?") stay together.
  let start = q;
  while (start > 0 && sentences[start - 1]?.endsWith("?")) start--;
  return {
    before: sentences.slice(0, start).join(" "),
    ask: sentences.slice(start, q + 1).join(" "),
    after: sentences.slice(q + 1).join(" "),
  };
}

/** Everything the user said, as one text for POST /v1/goals/from-words. Skipped turns left out. */
export function userWords(turns: OnboardingTurn[]): string {
  return turns
    .filter(answered)
    .map((t) => t.text.trim())
    .join("\n");
}
