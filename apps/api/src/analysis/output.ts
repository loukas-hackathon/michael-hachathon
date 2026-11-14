import {
  ActionKind,
  CreateFocusBlockPayload,
  MoveCalendarBlockPayload,
  type RecommendationAction,
  voiceProblems,
} from "@michael/shared";
import { z } from "zod";
import { Zone } from "../patterns/time";
import { overlapWith } from "../patterns/util";
import { type ActionsAre, type BriefContext, DETECTOR_NAMES } from "./brief";

// The model's answer: its shape, the checks on it, and the mapping to what we store.
//
// Three layers, in this order:
//   1. the JSON schema the API holds the model to (structured outputs);
//   2. zod, because a refusal, a cut off answer or a fallback model can still return something else;
//   3. `enforce`: the rules that must never depend on a model (whose goal, whose calendar block,
//      how many recommendations). `lintCopy` checks the hard copy rules.

const ACTION_KINDS = ActionKind.options;
// What a recommendation may rest on besides a pattern: the goals and their blocks, or the score.
export const EVIDENCE_BEYOND_PATTERNS: readonly string[] = ["plan", "score"];
export const MAX_RECOMMENDATIONS = 3;

// ---------- 1. the schema sent to the API ----------

// Nullable the documented way: `anyOf` with the null type.
const nullable = (type: string, description: string) => ({
  anyOf: [{ type }, { type: "null" }],
  description,
});

// Structured outputs take a subset of JSON Schema: every object closed (`additionalProperties:
// false`) with all keys required, no length or number limits. Limits are checked by zod below.
export const ANSWER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "recommendations", "question"],
  properties: {
    summary: { type: "string", description: "Michael's brief for the moment. At most four lines." },
    recommendations: {
      type: "array",
      description: "Zero to three. The first is the lead.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["goal_id", "title", "rationale", "action", "evidence"],
        properties: {
          goal_id: nullable("string", "The id of one of the goals in the brief, or null."),
          title: { type: "string", description: "The finding as a headline, with its number." },
          rationale: { type: "string", description: "The maths and the fix. At most three short sentences." },
          action: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "block", "day", "start", "end", "app", "text"],
                properties: {
                  kind: { type: "string", enum: ACTION_KINDS },
                  block: nullable(
                    "string",
                    'The ref of one of the person\'s own blocks in the plan, e.g. "b2".',
                  ),
                  day: nullable("string", "Local date, YYYY-MM-DD."),
                  start: nullable("string", "Local 24 hour time, HH:MM."),
                  end: nullable("string", "Local 24 hour time, HH:MM."),
                  app: nullable("string", "The app to close, by the name the brief uses."),
                  text: nullable("string", "The draft or the reminder line."),
                },
              },
            ],
          },
          evidence: {
            type: "array",
            items: { type: "string", enum: [...DETECTOR_NAMES, ...EVIDENCE_BEYOND_PATTERNS] },
            description:
              'Names of the patterns in the brief that support it, e.g. "phone_cadence". Also "plan" or "score" when the finding comes from the goals and their blocks.',
          },
        },
      },
    },
    question: nullable("string", "One short question about a missing fact, or null."),
  },
} as const;

// ---------- 2. zod ----------

const ModelAction = z.object({
  // Checked against ActionKind in `enforce`, so that an unknown kind drops the action only.
  kind: z.string(),
  block: z.string().nullable(),
  day: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  app: z.string().nullable(),
  text: z.string().nullable(),
});
export type ModelAction = z.infer<typeof ModelAction>;

export const CoachAnswer = z.object({
  summary: z.string().trim().min(1).max(1200),
  recommendations: z
    .array(
      z.object({
        goal_id: z.string().nullable(),
        title: z.string().trim().min(1).max(200),
        rationale: z.string().trim().min(1).max(800),
        action: ModelAction.nullable(),
        evidence: z.array(z.string()).max(12),
      }),
    )
    .max(12),
  question: z.string().trim().max(300).nullable(),
});
export type CoachAnswer = z.infer<typeof CoachAnswer>;

export class AnswerError extends Error {}

/** Text from the model to a checked answer. Throws AnswerError with a reason a log can keep. */
export function parseAnswer(text: string): CoachAnswer {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AnswerError("the model's answer is not valid JSON");
  }
  const result = CoachAnswer.safeParse(raw);
  if (!result.success) {
    const where = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "answer"}: ${i.message}`)
      .join("; ");
    throw new AnswerError(`the model's answer does not have the agreed shape (${where})`);
  }
  return result.data;
}

// ---------- 3. rules that never depend on the model ----------

export interface RecommendationDraft {
  goal_id: string | null;
  title: string;
  rationale: string;
  action: RecommendationAction | null;
  evidence: string[];
}

export interface Enforced {
  summary: string;
  question: string | null;
  recommendations: RecommendationDraft[];
  /** Everything the code changed, in plain words: for the log and for one retry. */
  corrections: Correction[];
}

export interface Correction {
  /** `action_dropped` leaves a rationale that may describe a change that was not made. */
  kind: "goal_unknown" | "action_dropped" | "evidence_unknown" | "too_many";
  where: string;
  detail: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Local day and "HH:MM" to an instant, or null when either is not what was asked for. */
function instant(zone: Zone, day: string | null, time: string | null): number | null {
  if (!day || !time || !DAY_RE.test(day) || !TIME_RE.test(time)) return null;
  const [h, m] = time.split(":").map(Number);
  const at = zone.at(day, (h ?? 0) * 60 + (m ?? 0));
  return Number.isFinite(at) ? at : null;
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The model's action as something we may store, or the reason it is dropped. Michael acts only on
 * the person's own time: a block with a ref, or free time that touches nobody else's.
 */
function checkAction(
  a: ModelAction,
  ctx: BriefContext,
  goalId: string | null,
): RecommendationAction | string {
  const kind = ActionKind.safeParse(a.kind);
  if (!kind.success) return `"${a.kind}" is not an action Michael can take`;
  const zone = new Zone(ctx.timezone);
  const start = instant(zone, a.day, a.start);
  let end = instant(zone, a.day, a.end);
  // An end at or before the start means the window runs past midnight.
  if (start !== null && end !== null && end <= start) end = instant(zone, zone.nextDay(a.day ?? ""), a.end);
  const free = (s: number, e: number) => overlapWith({ start: s, end: e }, ctx.busy) === 0;
  const done = (payload: Record<string, unknown>, undoUntil: number | null): RecommendationAction => ({
    kind: kind.data,
    payload,
    involves_others: false,
    undo_until: undoUntil === null ? null : iso(undoUntil),
  });

  switch (kind.data) {
    case "move_calendar_block": {
      const block = a.block ? ctx.blocks.get(a.block) : undefined;
      if (!block) return "it does not name one of the person's own blocks that can still be moved";
      if (start === null) return "it has no valid new day and start time";
      const newEnd = end ?? start + (block.end - block.start);
      if (start <= ctx.now) return "the new time is in the past";
      if (!free(start, newEnd)) return "the new time overlaps an event with other people";
      // The payload is exactly what POST /v1/recommendations/:id/execute carries out.
      const payload = MoveCalendarBlockPayload.safeParse({
        event_id: block.eventId,
        start_at: iso(start),
        end_at: iso(newEnd),
      });
      if (!payload.success) return "the block cannot be moved as asked";
      return done(payload.data, Math.min(block.start, start));
    }
    case "create_focus_block": {
      if (start === null || end === null) return "it has no valid day, start and end";
      if (start <= ctx.now) return "it starts in the past";
      if (!free(start, end)) return "it overlaps an event with other people";
      // Named the way the goal's blocks are named on the calendar, so the new block counts
      // towards the goal. Otherwise the model's own short name, or the executor's default.
      const title = (goalId ? ctx.blockTitles.get(goalId) : undefined) ?? a.text?.trim().slice(0, 200);
      const payload = CreateFocusBlockPayload.safeParse({
        start_at: iso(start),
        end_at: iso(end),
        ...(title ? { title } : {}),
      });
      if (!payload.success) return "the block cannot be created as asked";
      return done(payload.data, start);
    }
    case "block_mac_app": {
      if (!a.app?.trim()) return "it does not name an app";
      if (start === null || end === null) return "it has no valid day, start and end";
      if (end <= ctx.now) return "its window is in the past";
      const named = a.block ? ctx.blocks.get(a.block) : undefined;
      if (a.block && !named) return "it names a block that is not the person's own";
      const inside = named ?? ctx.goalBlocks.find((b) => start >= b.start && end <= b.end);
      if (!inside || start < inside.start || end > inside.end)
        return "its window is not inside a planned block";
      return done(
        { app: a.app.trim(), start_at: iso(start), end_at: iso(end), block_event_id: inside.eventId },
        start,
      );
    }
    case "draft_follow_up": {
      if (!a.text?.trim()) return "it has no draft text";
      // A draft stays with the person. Michael never sends anything.
      return done({ text: a.text.trim() }, null);
    }
    case "reminder": {
      if (!a.text?.trim()) return "it has no reminder text";
      if (start === null) return "it has no valid day and time";
      if (start <= ctx.now) return "its time is in the past";
      return done({ at: iso(start), text: a.text.trim() }, start);
    }
  }
}

export function enforce(answer: CoachAnswer, ctx: BriefContext): Enforced {
  const corrections: Correction[] = [];
  if (answer.recommendations.length > MAX_RECOMMENDATIONS) {
    corrections.push({
      kind: "too_many",
      where: "recommendations",
      detail: `${answer.recommendations.length} given, the first ${MAX_RECOMMENDATIONS} kept`,
    });
  }
  const recommendations = answer.recommendations.slice(0, MAX_RECOMMENDATIONS).map((r, i) => {
    const where = `recommendations[${i}]`;
    let goalId = r.goal_id;
    if (goalId !== null && !ctx.goalIds.has(goalId)) {
      corrections.push({
        kind: "goal_unknown",
        where: `${where}.goal_id`,
        detail: "not one of the person's goals",
      });
      goalId = null;
    }
    let action: RecommendationAction | null = null;
    if (r.action) {
      const checked = checkAction(r.action, ctx, goalId);
      if (typeof checked === "string") {
        corrections.push({ kind: "action_dropped", where: `${where}.action`, detail: checked });
      } else action = checked;
    }
    const evidence = [...new Set(r.evidence)].filter(
      (name) => ctx.patterns.has(name) || EVIDENCE_BEYOND_PATTERNS.includes(name),
    );
    if (evidence.length < new Set(r.evidence).size) {
      corrections.push({
        kind: "evidence_unknown",
        where: `${where}.evidence`,
        detail: "names that are neither a pattern with data in the brief nor plan or score were removed",
      });
    }
    return { goal_id: goalId, title: r.title, rationale: r.rationale, action, evidence };
  });
  return { summary: answer.summary, question: answer.question?.trim() || null, recommendations, corrections };
}

// ---------- copy rules ----------

export interface CopyViolation {
  where: string;
  rule: string;
  found: string;
}

const BANNED: [RegExp, string][] = [
  [/\bproductivity\b/i, "productivity"],
  [/\boptimi[sz](e[ds]?|ing|ation)\b/i, "optimise"],
  [/\bhustl(e[ds]?|ing)\b/i, "hustle"],
  [/\bcrush(e[ds]|ing)?\b/i, "crush"],
  [/\bjourneys?\b/i, "journey"],
  [/\bwellness\b/i, "wellness"],
  [/\bunlock(s|ed|ing)?\b/i, "unlock"],
  [/\bpotential\b/i, "potential"],
  [/\bamazing\b/i, "amazing"],
  [/\bgreat job\b/i, "great job"],
];

// Dashes used as punctuation: any long dash, a hyphen with a space on either side, a doubled
// hyphen, or a hyphen between two numbers ("10-12"). A hyphen inside a word is spelling, not
// punctuation, and passes.
const DASHES: RegExp[] = [/[‒–—―−]/, /(^|\s)-+(\s|$)/, /--/, /\d-\d/];

/**
 * The hard copy rules, checked on one piece of Michael's own text: the coach instructions' own
 * list (stricter on dashes, and on every form of a banned word) on top of the shared voice check.
 */
export function lintText(text: string): { rule: string; found: string }[] {
  const out: { rule: string; found: string }[] = [];
  const around = (index: number, length: number) =>
    text.slice(Math.max(0, index - 20), Math.min(text.length, index + length + 20)).trim();
  for (const re of DASHES) {
    const hit = re.exec(text);
    if (hit) {
      out.push({
        rule: "no dashes as punctuation: use a full stop or a comma",
        found: around(hit.index, hit[0].length),
      });
      break;
    }
  }
  const emoji = /\p{Extended_Pictographic}/u.exec(text);
  if (emoji) out.push({ rule: "no emoji", found: around(emoji.index, emoji[0].length) });
  const bang = text.indexOf("!");
  if (bang >= 0) out.push({ rule: "no exclamation marks", found: around(bang, 1) });
  for (const [re, word] of BANNED) {
    const hit = re.exec(text);
    if (hit) out.push({ rule: `never use the word "${word}"`, found: around(hit.index, hit[0].length) });
  }
  // The shared voice (packages/shared/src/voice.ts) is the floor for every line Michael says:
  // whatever it finds that the rules above did not is a violation too.
  for (const problem of voiceProblems(text)) {
    if (problem === "dash" && !out.some((v) => v.rule.startsWith("no dashes"))) {
      out.push({ rule: "no dashes as punctuation: use a full stop or a comma", found: text.slice(0, 60) });
    }
    const word = problem.startsWith("banned word: ") ? problem.slice("banned word: ".length) : null;
    if (word && !BANNED.some(([re]) => re.test(word))) {
      out.push({ rule: `never use the word "${word}"`, found: word });
    }
  }
  return out;
}

// A first person claim that something is already done: "I've set", "I have moved", "I added",
// "already moved". Deliberately narrow: an offer ("I can move", "I'll add") never matches.
const CLAIMS_DONE: RegExp[] = [
  /\bI(?:['’]ve| have)\s+(?:already\s+|just\s+)?(?:set|added|moved|closed|created|pushed|blocked|shifted|put|scheduled|booked)\b/i,
  /\bI\s+(?:already\s+|just\s+)?(?:set|added|moved|closed|created|pushed|blocked|shifted)\b/,
  /\b(?:already|both are|is now|are now)\s+(?:set|added|moved|closed|created|pushed|blocked|shifted|scheduled|booked)\b/i,
];
export const OFFER_RULE =
  'actions are offers: nothing has happened yet, so never write that you did it. Write the offer ("I can move your run to 07:00. One tap.")';

/** The part of a line that says an action was carried out, or null. Only wrong while actions are offers. */
export function claimsDone(text: string): string | null {
  for (const re of CLAIMS_DONE) {
    const hit = re.exec(text);
    if (hit) return text.slice(Math.max(0, hit.index - 20), hit.index + hit[0].length + 20).trim();
  }
  return null;
}

/**
 * Every piece of copy the person reads: the summary, the question, each title and rationale.
 * While actions are offers, a summary or rationale that says something was already done is a
 * violation too: nothing is carried out until the person taps.
 */
export function lintCopy(
  answer: Pick<Enforced, "summary" | "question" | "recommendations">,
  actionsAre: ActionsAre = "offers",
): CopyViolation[] {
  const fields: [string, string | null][] = [
    ["summary", answer.summary],
    ["question", answer.question],
    ...answer.recommendations.flatMap((r, i): [string, string][] => [
      [`recommendations[${i}].title`, r.title],
      [`recommendations[${i}].rationale`, r.rationale],
    ]),
  ];
  return fields.flatMap(([where, text]) => {
    if (!text) return [];
    const found = lintText(text).map((v) => ({ where, ...v }));
    const claim =
      actionsAre === "offers" && (where === "summary" || where.endsWith(".rationale"))
        ? claimsDone(text)
        : null;
    return claim ? [...found, { where, rule: OFFER_RULE, found: claim }] : found;
  });
}
