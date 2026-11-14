import { createHash } from "node:crypto";
import {
  type AnalysisResult,
  type AnalysisSpecialist,
  type Goal,
  goalArea,
  isSleepGoal,
  type RecommendationAction,
} from "@michael/shared";
import { z } from "zod";
import { currentUserId } from "../context";
import { HttpError } from "../http";
import { type Brief, type BriefContext, briefJson, renderUserMessage } from "./brief";
import { COACH_INSTRUCTIONS } from "./coach";
import { type ModelClient, ModelError } from "./model";
import { inventedNumbers, type KnownNumbers, knownNumbers, numberViolations } from "./numbers";
import {
  ANSWER_JSON_SCHEMA,
  AnswerError,
  type CoachAnswer,
  checkAction,
  EVIDENCE_BEYOND_PATTERNS,
  type ModelAction,
  parseAnswer,
} from "./output";
import {
  type AnalysisDeps,
  type AnalysisRequest,
  type Checked,
  check,
  type PreparedBrief,
  prepareBrief,
  problems,
  retryMessage,
  runAnalysis,
} from "./run";

// Analysis v2 (#20): four specialists and a coordinator, on top of the single pass (run.ts).
//
//   1. The brief is built once (prepareBrief). Each specialist gets only its slice of it: its own
//      goals and their blocks, the patterns that belong to its domain, the data notes. Summaries
//      only, never raw data, exactly as the single pass.
//   2. The specialists run in parallel at low effort and return findings (structured output,
//      checked with zod). The code checks each finding: its goal is one of the domain's, its
//      numbers are in its slice, its action passes the same rules as any other (checkAction).
//   3. The code merges them: duplicates go, and two actions that want the same time are settled
//      (higher confidence wins; when close, rest beats training beats work beats food).
//   4. The coordinator gets the full brief and the merged findings, and writes the usual answer
//      in Michael's voice: at most three recommendations. The answer goes through the same checks
//      as the single pass (enforce, lintCopy, one retry) plus the number guard (numbers.ts).
//
// If any specialist or the coordinator fails, the run falls back to the single pass, so the
// person always gets a brief.

export const SPECIALISTS: readonly AnalysisSpecialist[] = ["work", "training", "rest", "food"];

/** When two actions want the same time and the confidences are close, the earlier one wins. */
const PRIORITY: readonly AnalysisSpecialist[] = ["rest", "training", "work", "food"];
/** "Close": a confidence gap smaller than this is settled by PRIORITY. */
const CLOSE = 0.1;
const MAX_FINDINGS_PER_SPECIALIST = 4;
/** How many merged findings the coordinator sees. It keeps at most three. */
const MAX_CANDIDATES = 6;

/** The patterns each specialist reads. Training and food have none yet: they read plan and goals. */
const DETECTORS: Record<AnalysisSpecialist, readonly string[]> = {
  work: [
    "phone_cadence",
    "mac_app_cadence",
    "focus_disruptions",
    "recovery_cost",
    "repeat_offenders",
    "drift",
    "context_switching",
    "time_by_app",
    "ai_tool_use",
  ],
  training: [],
  rest: ["late_screens"],
  food: [],
};
const HOURLY: Record<AnalysisSpecialist, boolean> = { work: true, training: false, rest: true, food: false };

const FOOD = /\b(food|meals?|eat(ing)?|protein|diet|nutrition|lunch|dinner|breakfast|cook(ing)?)\b/i;
const REST = /\b(sleep|rest|recover(y)?|bed(time)?|nap)\b/i;

/** The specialist a goal belongs to. Goals are grouped by area first, then by what they describe. */
export function specialistOf(goal: Goal): AnalysisSpecialist {
  if (goal.category === "food") return "food";
  if (goal.category === "rest" || isSleepGoal(goal)) return "rest";
  if (goal.category === "gym") return "training";
  const area = goalArea(goal.category);
  if (area === "business") return "work";
  if (area === "health") return FOOD.test(goal.title) ? "food" : REST.test(goal.title) ? "rest" : "training";
  // Personal goals: evenings out and time off sit with rest; study and side projects with work.
  return REST.test(goal.title) || /\b(evenings?|fun|friends|family|out)\b/i.test(goal.title)
    ? "rest"
    : "work";
}

// ---------- the slice of the brief each specialist reads ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function sliceReport(report: unknown, detectors: readonly string[], hourly: boolean): Obj | null {
  if (!isObj(report)) return null;
  const list = Array.isArray(report.detectors) ? report.detectors : [];
  const kept = list.filter((d) => isObj(d) && detectors.includes(String(d.name)));
  const silent = isObj(report.not_enough_data)
    ? Object.fromEntries(Object.entries(report.not_enough_data).filter(([k]) => detectors.includes(k)))
    : {};
  return {
    from: report.from,
    to: report.to,
    ...(report.days_cut_short ? { days_cut_short: report.days_cut_short } : {}),
    detectors: kept,
    not_enough_data: silent,
    ...(hourly && report.screen_minutes_by_hour
      ? { screen_minutes_by_hour: report.screen_minutes_by_hour }
      : {}),
  };
}

/**
 * One specialist's view of the brief: its goals, their blocks, the busy time it must not touch,
 * its patterns and the data notes. Null when it has nothing to read (no goals, or nothing with
 * numbers), so no call is made for it.
 */
export function sliceBrief(brief: Brief, specialist: AnalysisSpecialist, goals: Goal[]): Brief | null {
  const mine = goals.filter((g) => g.active && specialistOf(g) === specialist);
  if (mine.length === 0) return null;
  const ids = new Set(mine.map((g) => g.id));
  const titles = new Set(mine.map((g) => g.title));
  const briefGoals = (Array.isArray(brief.goals) ? brief.goals : []).filter(
    (g) => isObj(g) && ids.has(String(g.id)),
  );

  const plan = isObj(brief.plan) ? brief.plan : {};
  const week = isObj(plan.week) ? plan.week : {};
  const days = (Array.isArray(plan.days) ? plan.days : []).filter(isObj).map((d) => {
    const { planned_minutes: _p, so_far: _s, goal_blocks, ...rest } = d;
    const blocks = (Array.isArray(goal_blocks) ? goal_blocks : []).filter(
      (b) => isObj(b) && titles.has(String(b.goal)),
    );
    return { ...rest, goal_blocks: blocks };
  });

  const detectors = DETECTORS[specialist];
  const patterns = isObj(brief.patterns) ? brief.patterns : {};
  const sliced = Object.fromEntries(
    Object.entries(patterns)
      .map(([k, v]) => [k, sliceReport(v, detectors, HOURLY[specialist])] as const)
      .filter(([, v]) => v !== null),
  );
  const anyData = Object.values(sliced).some((r) => Array.isArray(r?.detectors) && r.detectors.length > 0);
  const anyBlocks = days.some((d) => d.goal_blocks.length > 0);
  const anyScored = briefGoals.some((g) => isObj(g) && isObj(g.this_week) && g.this_week.scored !== false);
  if (!anyData && !anyBlocks && !anyScored) return null;

  return {
    specialist,
    now: brief.now,
    weekday: brief.weekday,
    timezone: brief.timezone,
    trigger: brief.trigger,
    range: brief.range,
    goals: briefGoals,
    instructions: brief.instructions,
    plan: {
      week: {
        from: week.from,
        to: week.to,
        days_left_after_today: week.days_left_after_today,
        minutes_free_for_goals_until_sunday: week.minutes_free_for_goals_until_sunday,
        free_rule: week.free_rule,
      },
      days,
    },
    patterns: sliced,
    // What Michael already said is the coordinator's business (it has the whole brief). Left out
    // here, a run does not change the next run's slices, so a second tap hits the cache.
    data_notes: brief.data_notes,
  };
}

// ---------- the specialist's instructions and answer ----------

const FOCUS: Record<AnalysisSpecialist, string> = {
  work: "You are the work and focus specialist. Your domain: the person's business and study goals, their deep work blocks, and what takes time out of those blocks (apps, sites, the phone, switching, drift, AI tool sessions).",
  training:
    "You are the training specialist. Your domain: the person's training goals (gym, runs, swims, races) and the blocks planned for them: whether the week's sessions are planned, whether they happen, and what keeps pushing them out.",
  rest: "You are the sleep and rest specialist. Your domain: sleep, screens late at night, recovery, and the person's time off. You protect the night: no plan should cut into the sleep the person set as a goal.",
  food: "You are the food specialist. Your domain: the person's food goals: meals, protein, regular eating, and whether the day leaves room for them.",
};

const SPECIALIST_RULES = `You are one of four specialists working for Michael, a coach for one person's whole day. Michael writes to the person; you write only to Michael. He merges what the four of you find, so stay strictly inside your domain and leave everything else to the others.

What you receive. Your slice of the person's brief in JSON: your goals with their weekly budgets and how this week is going, their blocks in the plan, busy time with other people (which can never be touched), the patterns of your domain with numbers, and notes about what the data can and cannot show.

What you return. Up to four findings, best first, or none. None is a good answer when nothing in your slice costs a goal. A finding is:
- \`finding\`: one plain sentence with its number. What it cost which goal.
- \`maths\`: the numbers behind it, in one line, each one copied from your slice ("planned 240, spent 95, lost 145").
- \`evidence_numbers\`: every number the finding and the maths use, each exactly as it appears in your slice.
- \`goal_id\`: the id of one of your goals, or null.
- \`confidence\`: 0 to 1. How sure the data makes you, and how much it matters to the goal in the next 24 hours. Below 0.3, leave it out.
- \`evidence\`: the names of the patterns in your slice that support it, or "plan" or "score".
- \`action\`: one change Michael could offer, or null. Only these kinds: \`create_focus_block\`, \`move_calendar_block\` (only a block with a \`ref\`), \`block_mac_app\` (a named app on the computer, inside a planned block), \`reminder\` (one line at one time). Every field present, null where a kind does not need it: \`block\` (a ref such as "b2"), \`day\` (YYYY-MM-DD), \`start\` and \`end\` (HH:MM, local), \`app\`, \`text\`. An action lies in the future, inside the person's own time, never over busy time, and never inside time a standing instruction protects.

Rules. The numbers in your slice are the only facts you have: never estimate, never add a number that is not there. A pattern listed as not having enough data does not exist. Phone numbers are sessions in which an app was opened, not pickups. Blocks with no device data are unverified, not missed. Nothing about other people. Answer with the JSON only.`;

/** The system prompt of one specialist. Stable per specialist, so the prompt cache can serve it. */
export const specialistInstructions = (s: AnalysisSpecialist) => `${FOCUS[s]}\n\n${SPECIALIST_RULES}`;

const ACTION_SCHEMA = ANSWER_JSON_SCHEMA.properties.recommendations.items.properties.action;
const EVIDENCE_SCHEMA = ANSWER_JSON_SCHEMA.properties.recommendations.items.properties.evidence;

export const FINDINGS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      description: "Zero to four, best first.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["finding", "maths", "evidence_numbers", "goal_id", "confidence", "evidence", "action"],
        properties: {
          finding: { type: "string", description: "One sentence with its number." },
          maths: { type: "string", description: "The numbers behind it, copied from the slice." },
          evidence_numbers: { type: "array", items: { type: "string" } },
          goal_id: { anyOf: [{ type: "string" }, { type: "null" }] },
          confidence: { type: "number", description: "0 to 1." },
          evidence: EVIDENCE_SCHEMA,
          action: ACTION_SCHEMA,
        },
      },
    },
  },
} as const;

const RawFinding = z.object({
  finding: z.string().trim().min(1).max(300),
  maths: z.string().trim().max(300),
  evidence_numbers: z.array(z.string()).max(20),
  goal_id: z.string().nullable(),
  confidence: z.number(),
  evidence: z.array(z.string()).max(12),
  action: z
    .object({
      kind: z.string(),
      block: z.string().nullable(),
      day: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      app: z.string().nullable(),
      text: z.string().nullable(),
    })
    .nullable(),
});
const RawFindings = z.object({ findings: z.array(RawFinding).max(12) });
type RawFinding = z.infer<typeof RawFinding>;

export class SpecialistError extends Error {
  constructor(
    public specialist: AnalysisSpecialist,
    message: string,
  ) {
    super(`${specialist} specialist: ${message}`);
  }
}

export function parseFindings(specialist: AnalysisSpecialist, text: string): RawFinding[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SpecialistError(specialist, "the answer is not valid JSON");
  }
  const result = RawFindings.safeParse(raw);
  if (!result.success) throw new SpecialistError(specialist, "the answer does not have the agreed shape");
  return result.data.findings;
}

// ---------- checking and merging findings ----------

/** A finding that passed the code's checks, ready to merge. */
export interface Finding {
  /** "w1", "t2", "r1", "f1": how the coordinator names it. */
  ref: string;
  specialist: AnalysisSpecialist;
  finding: string;
  maths: string;
  evidence_numbers: string[];
  goal_id: string | null;
  confidence: number;
  evidence: string[];
  /** The model's action as written: the coordinator copies it. Null when dropped. */
  action: ModelAction | null;
  /** What the action would do, once checked. Null when there is none. */
  checked: RecommendationAction | null;
  /** Why the code changed it, if it did: for the coordinator and the log. */
  notes: string[];
}

/**
 * The code's checks on one specialist's findings: its own goals only, numbers from its own slice
 * only (a finding with an invented number is dropped whole), actions that pass `checkAction`.
 */
export function checkFindings(
  specialist: AnalysisSpecialist,
  raw: RawFinding[],
  ctx: BriefContext,
  goalIds: Set<string>,
  known: KnownNumbers,
): { findings: Finding[]; dropped: { finding: string; reason: string }[] } {
  const dropped: { finding: string; reason: string }[] = [];
  const allowedEvidence = new Set([
    ...DETECTORS[specialist].filter((d) => ctx.patterns.has(d)),
    ...EVIDENCE_BEYOND_PATTERNS,
  ]);
  const findings: Finding[] = [];
  for (const r of raw) {
    if (findings.length >= MAX_FINDINGS_PER_SPECIALIST) break;
    const times = r.action ? [r.action.start, r.action.end].filter((x): x is string => !!x) : [];
    const invented = [
      ...inventedNumbers(r.finding, known, times),
      ...inventedNumbers(r.maths, known, times),
      ...r.evidence_numbers.flatMap((n) => inventedNumbers(n, known, times)),
    ];
    if (invented.length > 0) {
      dropped.push({
        finding: r.finding,
        reason: `numbers not in its slice: ${[...new Set(invented)].join(", ")}`,
      });
      continue;
    }
    const notes: string[] = [];
    const goalId = r.goal_id !== null && goalIds.has(r.goal_id) ? r.goal_id : null;
    if (r.goal_id !== null && goalId === null) notes.push("its goal is not one of this specialist's");
    let action: ModelAction | null = null;
    let checked: RecommendationAction | null = null;
    if (r.action) {
      const result = checkAction(r.action, ctx, goalId);
      if (typeof result === "string") notes.push(`its action was dropped: ${result}`);
      else {
        action = r.action;
        checked = result;
      }
    }
    findings.push({
      ref: `${specialist[0]}${findings.length + 1}`,
      specialist,
      finding: r.finding,
      maths: r.maths,
      evidence_numbers: r.evidence_numbers,
      goal_id: goalId,
      confidence: Math.min(1, Math.max(0, Number.isFinite(r.confidence) ? r.confidence : 0)),
      evidence: [...new Set(r.evidence)].filter((e) => allowedEvidence.has(e)),
      action,
      checked,
      notes,
    });
  }
  return { findings, dropped };
}

/** The time an action takes on the calendar, or null for one with no time (a draft). */
function windowOf(a: RecommendationAction | null): { start: number; end: number } | null {
  if (!a) return null;
  const p = a.payload as Record<string, unknown>;
  const ms = (v: unknown) => (typeof v === "string" ? Date.parse(v) : Number.NaN);
  const start = ms(p.start_at ?? p.at);
  const end = ms(p.end_at);
  if (!Number.isFinite(start)) return null;
  return { start, end: Number.isFinite(end) && end > start ? end : start + 60_000 };
}

const overlaps = (a: { start: number; end: number } | null, b: { start: number; end: number } | null) =>
  a !== null && b !== null && a.start < b.end && b.start < a.end;
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** True when `a` beats `b` for the same time. */
function beats(a: Finding, b: Finding): boolean {
  if (Math.abs(a.confidence - b.confidence) >= CLOSE) return a.confidence > b.confidence;
  return PRIORITY.indexOf(a.specialist) < PRIORITY.indexOf(b.specialist);
}

export interface Merged {
  candidates: Finding[];
  duplicates: { kept: string; dropped: string }[];
  conflicts: { winner: string; loser: string; reason: string }[];
}

/**
 * The code's half of the coordinator, before any model sees it: drop duplicates, settle two
 * actions that want the same time, rank by confidence, keep the best few.
 */
export function mergeFindings(all: Finding[]): Merged {
  const sorted = [...all].sort(
    (a, b) => b.confidence - a.confidence || PRIORITY.indexOf(a.specialist) - PRIORITY.indexOf(b.specialist),
  );
  const duplicates: Merged["duplicates"] = [];
  const conflicts: Merged["conflicts"] = [];
  const kept: Finding[] = [];
  for (const f of sorted) {
    // A duplicate: the same sentence, or the same goal asking for the same kind of change at the
    // same time. The one ranked higher stays and takes the other's evidence.
    const twin = kept.find(
      (k) =>
        words(k.finding) === words(f.finding) ||
        (k.goal_id !== null &&
          k.goal_id === f.goal_id &&
          k.checked !== null &&
          f.checked?.kind === k.checked.kind &&
          overlaps(windowOf(k.checked), windowOf(f.checked))),
    );
    if (twin) {
      twin.evidence = [...new Set([...twin.evidence, ...f.evidence])];
      duplicates.push({ kept: twin.ref, dropped: f.ref });
      continue;
    }
    kept.push({ ...f, notes: [...f.notes] });
  }
  // Two actions from different specialists that want the same time: one keeps its action.
  for (const a of kept) {
    for (const b of kept) {
      if (a === b || a.specialist === b.specialist || !a.checked || !b.checked) continue;
      if (!overlaps(windowOf(a.checked), windowOf(b.checked))) continue;
      const [winner, loser] = beats(a, b) ? [a, b] : [b, a];
      const reason =
        Math.abs(a.confidence - b.confidence) >= CLOSE
          ? "higher confidence"
          : `confidences are close and ${winner.specialist} comes before ${loser.specialist}`;
      loser.action = null;
      loser.checked = null;
      loser.notes.push(`its action wanted the same time as ${winner.ref} and gave way (${reason})`);
      conflicts.push({ winner: winner.ref, loser: loser.ref, reason });
    }
  }
  return { candidates: kept.slice(0, MAX_CANDIDATES), duplicates, conflicts };
}

// ---------- the coordinator ----------

const COORDINATOR_RULES = `Working with specialists. On this run four specialists (work, training, rest, food) read their part of the brief first. Their findings follow the brief under \`specialist_findings\`, best first. The code has already checked them: each finding's numbers are in the brief, its goal is real, and its action passes the rules. The code has also dropped duplicates and settled any two actions that wanted the same time (\`conflicts\` says who gave way and why).
- Choose from the findings. Every rule above still holds: start from the goals, one lead, a second or third only for a different goal.
- Set \`finding\` on each recommendation to the \`ref\` of the finding it comes from. Use null only when no finding covers it, which should be rare.
- When you use a finding's action, copy it exactly. Never give back an action the code removed, and never give a loser of a conflict its time back.
- When two findings pull against each other (a late session against the night's sleep), choose, and say the trade in one line with both numbers.
- Write in your own voice. The findings are notes to you, not copy.`;

/** The coordinator's system prompt: the coach instructions, then how to use the specialists. Stable. */
export const COORDINATOR_INSTRUCTIONS = `${COACH_INSTRUCTIONS}\n\n${COORDINATOR_RULES}`;

const items = ANSWER_JSON_SCHEMA.properties.recommendations.items;
/** The usual answer, with one more key per recommendation: the ref of the finding it came from. */
export const COORDINATOR_JSON_SCHEMA = {
  ...ANSWER_JSON_SCHEMA,
  properties: {
    ...ANSWER_JSON_SCHEMA.properties,
    recommendations: {
      ...ANSWER_JSON_SCHEMA.properties.recommendations,
      items: {
        ...items,
        required: [...items.required, "finding"],
        properties: {
          ...items.properties,
          finding: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: 'The ref of the specialist finding it comes from, e.g. "w1", or null.',
          },
        },
      },
    },
  },
} as const;

const FindingRefs = z.object({
  recommendations: z.array(z.object({ finding: z.string().nullable().optional() }).passthrough()),
});

/** The specialist behind each of the answer's recommendations, in order. */
function refsOf(text: string): (string | null)[] {
  try {
    const parsed = FindingRefs.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.recommendations.map((r) => r.finding ?? null) : [];
  } catch {
    return [];
  }
}

export function coordinatorMessage(brief: Brief, merged: Merged): string {
  const findings = merged.candidates.map((f) => ({
    ref: f.ref,
    specialist: f.specialist,
    finding: f.finding,
    maths: f.maths,
    goal_id: f.goal_id,
    confidence: Math.round(f.confidence * 100) / 100,
    evidence: f.evidence,
    action: f.action,
    ...(f.notes.length > 0 ? { notes: f.notes } : {}),
  }));
  return [
    renderUserMessage(brief),
    "",
    "The specialists' findings, checked and merged by the code:",
    "",
    briefJson({ specialist_findings: findings, conflicts: merged.conflicts }),
  ].join("\n");
}

// ---------- the cache ----------

// Findings per user per day by input hash: the same slice never costs a second call that day
// (a second tap, a run over a day that is already over). In memory; a restart forgets it.
const cache = new Map<string, RawFinding[]>();
const CACHE_MAX = 500;

export function clearSpecialistCache() {
  cache.clear();
}

function cacheKey(day: string, model: string, system: string, user: string): string {
  const hash = createHash("sha256").update(model).update("\0").update(system).update("\0").update(user);
  return `${currentUserId()}|${day}|${hash.digest("hex")}`;
}

// ---------- the run ----------

async function askSpecialist(
  specialist: AnalysisSpecialist,
  slice: Brief,
  model: ModelClient,
  day: string,
  log: (entry: Record<string, unknown>) => void,
): Promise<{ raw: RawFinding[]; user: string }> {
  const system = specialistInstructions(specialist);
  const user = [
    `Your slice of the brief, ${specialist} specialist. Times are local to its timezone. Durations are minutes unless the name says otherwise, shares run from 0 to 1.`,
    "",
    briefJson(slice),
  ].join("\n");
  const key = cacheKey(day, model.model, system, user);
  const hit = cache.get(key);
  if (hit) {
    log({ event: "analysis_specialist_cached", specialist });
    return { raw: hit, user };
  }
  let reply: Awaited<ReturnType<ModelClient["complete"]>>;
  try {
    reply = await model.complete({
      system,
      user,
      schema: FINDINGS_JSON_SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
    });
  } catch (err) {
    throw new SpecialistError(specialist, err instanceof Error ? err.message : "the call failed");
  }
  log({ event: "analysis_model_call", specialist, model: reply.model, usage: reply.usage ?? null });
  const raw = parseFindings(specialist, reply.text);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, raw);
  return { raw, user };
}

interface CoordinatorChecked extends Checked {
  answer: CoachAnswer;
  numbers: ReturnType<typeof numberViolations>;
}

/** The single pass's checks, plus the number guard, whose findings count as copy violations. */
function checkCoordinator(
  reply: Awaited<ReturnType<ModelClient["complete"]>>,
  ctx: BriefContext,
  known: KnownNumbers,
): CoordinatorChecked {
  const checked = check(reply, ctx);
  const answer = parseAnswer(reply.text);
  const numbers = numberViolations(answer, known);
  return { ...checked, violations: [...checked.violations, ...numbers], answer, numbers };
}

/** Runs the specialists and the coordinator. Throws on any failure: the caller falls back. */
async function specialistPass(
  prepared: PreparedBrief,
  goals: Goal[],
  deps: AnalysisDeps,
  log: (entry: Record<string, unknown>) => void,
): Promise<AnalysisResult> {
  const { store, model } = deps;
  const { brief, from, to, trigger, started } = prepared;
  const ctx = brief.context;
  const day = String(brief.brief.now ?? "").slice(0, 10);

  // 1 and 2: the specialists, side by side. Any failure stops the pass.
  const asked = SPECIALISTS.flatMap((s) => {
    const slice = sliceBrief(brief.brief, s, goals);
    return slice ? [{ specialist: s, slice }] : [];
  });
  if (asked.length === 0) throw new SpecialistError("work", "no specialist has anything to read");
  const answers = await Promise.all(
    asked.map(async ({ specialist, slice }) => {
      const { raw, user } = await askSpecialist(specialist, slice, model, day, log);
      const ids = new Set(goals.filter((g) => specialistOf(g) === specialist).map((g) => g.id));
      const result = checkFindings(specialist, raw, ctx, ids, knownNumbers([user]));
      if (result.dropped.length > 0)
        log({ event: "analysis_findings_dropped", specialist, dropped: result.dropped });
      return result.findings;
    }),
  );

  // 3: the code's merge.
  const merged = mergeFindings(answers.flat());
  log({
    event: "analysis_specialists_merged",
    asked: asked.map((a) => a.specialist),
    findings: answers.flat().length,
    candidates: merged.candidates.map((c) => c.ref),
    duplicates: merged.duplicates,
    conflicts: merged.conflicts,
  });

  // 4: the coordinator, with one retry told exactly what was wrong.
  const user = coordinatorMessage(brief.brief, merged);
  const known = knownNumbers([user]);
  const base = {
    system: COORDINATOR_INSTRUCTIONS,
    schema: COORDINATOR_JSON_SCHEMA as unknown as Record<string, unknown>,
  };
  const first = checkCoordinator(await model.complete({ ...base, user }), ctx, known);
  log({ event: "analysis_model_call", specialist: "coordinator", attempt: 1, model: first.reply.model });
  let chosen = first;
  if (problems(first) > 0) {
    try {
      const second = checkCoordinator(
        await model.complete({ ...base, user: retryMessage(user, first) }),
        ctx,
        known,
      );
      log({ event: "analysis_model_call", specialist: "coordinator", attempt: 2, model: second.reply.model });
      if (problems(second) <= problems(first)) chosen = second;
    } catch (err) {
      log({ event: "analysis_retry_failed", reason: err instanceof Error ? err.message : "unknown" });
    }
  }

  // The number guard is the one rule a stored answer may not break. An invented number in the
  // summary or the question sends the run to the single pass; a recommendation with one is dropped.
  const { enforced } = chosen;
  if (chosen.numbers.some((v) => v.where === "summary" || v.where === "question")) {
    throw new AnswerError("the coordinator's summary holds a number that is not in the brief");
  }
  const refs = refsOf(chosen.reply.text);
  const byRef = new Map(merged.candidates.map((c) => [c.ref, c]));
  const recommendations = enforced.recommendations.flatMap((r, i) => {
    if (chosen.numbers.some((v) => v.where.startsWith(`recommendations[${i}].`))) {
      log({ event: "analysis_recommendation_dropped", index: i, reason: "a number not in the brief" });
      return [];
    }
    const ref = refs[i];
    const source = ref ? byRef.get(ref) : undefined;
    // A finding whose action the code removed (a conflict it lost, a rule it broke) does not get
    // one back from the coordinator.
    const action = source && source.checked === null && r.action !== null ? null : r.action;
    if (action !== r.action) log({ event: "analysis_action_withheld", finding: source?.ref });
    return [{ ...r, action, specialist: source?.specialist ?? null }];
  });

  const finished = (deps.now ? deps.now() : new Date()).toISOString();
  const saved = await store.saveAnalysis({
    run: {
      trigger,
      range_start: from,
      range_end: to,
      started_at: started.toISOString(),
      status: "succeeded",
      model: chosen.reply.model,
      summary: enforced.summary,
      question: enforced.question,
      error: null,
      finished_at: finished,
    },
    recommendations,
  });
  if (enforced.corrections.length > 0 || chosen.violations.length > 0) {
    log({
      event: "analysis_answer_corrected",
      run_id: saved.run.id,
      corrections: enforced.corrections,
      copy_violations: chosen.violations,
    });
  }
  return saved;
}

/**
 * POST /v1/analysis/run?mode=specialists. Same input, same output and same storage as the single
 * pass (runAnalysis); each recommendation also says which specialist found it. Falls back to the
 * single pass, on the same brief, when any part of it fails.
 */
export async function runSpecialistAnalysis(
  request: AnalysisRequest,
  deps: AnalysisDeps,
): Promise<AnalysisResult> {
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const prepared = await prepareBrief(request, deps);
  try {
    const goals = await deps.store.listGoals();
    return await specialistPass(prepared, goals, deps, log);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const known = err instanceof SpecialistError || err instanceof ModelError || err instanceof AnswerError;
    log({
      event: "analysis_specialists_fallback",
      reason: err instanceof Error ? err.message : "unknown",
      expected: known,
    });
    return runAnalysis(request, { ...deps, log }, prepared);
  }
}
