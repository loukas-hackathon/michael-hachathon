import type { Recommendation } from "@michael/shared";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";

// #483: Michael said "I've added Gym" when nothing was saved in that answer. The prompt forbids it;
// this is the server side guard, so a claimed change always matches a change made in the same turn.

/** Tools that only read: their success never backs a claim of a change. */
const READ_TOOLS = new Set([
  "find_calendar_blocks",
  "get_week_review",
  "get_insights",
  "what_you_know",
  "draft_follow_up",
]);

/** One tool call of this turn, as the guard needs it. */
export interface ToolCallRecord {
  name: string;
  input: unknown;
  ok: boolean;
  /** What the tool said back, for an error the reply must name. */
  content: string;
}

/** A tool call that changes something (not a read, not a proposal waiting for Accept). */
export const isWriteTool = (name: string) => !READ_TOOLS.has(name) && !name.startsWith("propose_");

type Verb = "add" | "move" | "remove" | "log" | "change";
const VERB_OF: Record<string, Verb> = {
  added: "add",
  booked: "add",
  created: "add",
  scheduled: "add",
  put: "add",
  blocked: "add",
  moved: "move",
  pushed: "move",
  removed: "remove",
  deleted: "remove",
  logged: "log",
  renamed: "change",
  changed: "change",
  updated: "change",
};
const VERBS = Object.keys(VERB_OF).join("|");
// "I've added", "I have booked", "I just moved", "I've now logged".
const FIRST_PERSON = new RegExp(`\\bI(?:'ve| have)?(?: just| now| already)?\\s+(${VERBS})\\b`, "i");
// A line that opens with the change: "Added Gym, 10:00 to 11:00." "Booked." "Done."
const OPENS_WITH = /^(?:(added|booked|created|scheduled|moved|removed|deleted|logged|renamed)|done)\b/i;
// "It's there now", "It's in your calendar now".
const THERE_NOW = /\b(?:it's|it is) (?:there|in your calendar|on your calendar) now\b/i;
// "Undo until 10:00." on its own: only true when something was done.
const UNDO_ONLY = /^undo(?: until \d{1,2}:\d{2})?\.?$/i;
// A sentence that points at an earlier answer: it may be true, as long as the thread has a done action.
const EARLIER =
  /\b(?:earlier|yesterday|before|last time|this morning|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

const HONEST: Record<Verb | "any", string> = {
  add: "I haven't added it yet.",
  move: "I haven't moved it yet.",
  remove: "I haven't removed it yet.",
  log: "I haven't logged it yet.",
  change: "I haven't changed it yet.",
  any: "Nothing has changed yet.",
};

/** The verb a sentence claims as done, or null when it claims no change. */
export function claimedVerb(sentence: string): Verb | "any" | null {
  const s = sentence.trim();
  // "Have I added it?" asks; it claims nothing.
  if (s.endsWith("?")) return null;
  const first = FIRST_PERSON.exec(s) ?? OPENS_WITH.exec(s);
  if (first) return first[1] ? (VERB_OF[first[1].toLowerCase()] ?? "any") : "any";
  if (THERE_NOW.test(s)) return "add";
  return null;
}

const clock = (iso: unknown) =>
  typeof iso === "string" && !Number.isNaN(Date.parse(iso))
    ? new Zone(DEFAULT_TIMEZONE).clock(Date.parse(iso))
    : null;

/** "Shall I book Gym 10:00 to 11:00?" from the block the model tried to book, or a plain offer. */
function offerFor(verb: Verb | "any", calls: ToolCallRecord[]): string {
  const tried = calls.find((c) => c.name === "create_focus_block" || c.name === "focus_now");
  const input = (tried?.input ?? {}) as Record<string, unknown>;
  const from = clock(input.start_at);
  const to = clock(input.end_at);
  if (verb === "add" && typeof input.title === "string" && from && to)
    return `Shall I book ${input.title} ${from} to ${to}?`;
  return "Shall I do it now?";
}

/** "That time has already started" from "Refused (conflict): That time has already started". */
const reasonOf = (content: string) =>
  content
    .replace(/^Refused \([^)]*\):\s*/, "")
    .replace(/^Invalid input:\s*/, "the details did not check out: ")
    .replace(/[.\s]+$/, "");

export interface HonestyInput {
  answer: string;
  /** Recommendations done or undone in this turn. */
  actions: Recommendation[];
  /** Every tool call of this turn, in order. */
  calls: ToolCallRecord[];
  /** Done actions from earlier answers in the thread: a sentence about them may stand. */
  earlierDone?: number;
}

/**
 * The answer with every claimed change that this turn did not make replaced by one honest line
 * and an offer, or by the tool's error when one failed. Unchanged when the claims hold.
 */
export function honestAnswer({ answer, actions, calls, earlierDone = 0 }: HonestyInput): string {
  const wrote = calls.some((c) => c.ok && isWriteTool(c.name));
  const changed = wrote || actions.some((a) => a.status === "done" || a.status === "undone");
  if (changed) return answer;
  const failed = calls.find((c) => !c.ok && isWriteTool(c.name));
  let replaced = false;
  const paragraphs = answer.split(/\n{2,}/).map((p) => {
    const sentences = p.split(/(?<=[.?!])\s+/);
    const kept = sentences.flatMap((s) => {
      if (UNDO_ONLY.test(s.trim())) return [];
      const verb = claimedVerb(s);
      if (!verb) return [s];
      if (earlierDone > 0 && EARLIER.test(s)) return [s];
      if (replaced) return [];
      replaced = true;
      return failed
        ? [`That didn't go through: ${reasonOf(failed.content)}.`]
        : [HONEST[verb], offerFor(verb, calls)];
    });
    return kept.join(" ");
  });
  if (!replaced) return answer;
  return paragraphs.filter((p) => p.trim()).join("\n\n");
}
