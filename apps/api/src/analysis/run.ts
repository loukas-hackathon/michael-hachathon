import type { AnalysisResult, AnalysisRun, AnalysisTrigger, Event, EventType } from "@michael/shared";
import { HttpError } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { DAY, Zone } from "../patterns/time";
import { readAllEvents } from "../routes/score";
import type { Store } from "../store";
import { type BriefContext, briefWindow, buildBrief, renderUserMessage } from "./brief";
import { COACH_INSTRUCTIONS } from "./coach";
import { type ModelClient, ModelError, type ModelReply } from "./model";
import {
  ANSWER_JSON_SCHEMA,
  AnswerError,
  type CopyViolation,
  type Correction,
  type Enforced,
  enforce,
  lintCopy,
  parseAnswer,
} from "./output";

// One analysis run, end to end: read the user's data, write the brief, ask the model once, check
// the answer, store the run and its recommendations. The model and the clock are passed in.

export interface AnalysisDeps {
  store: Store;
  model: ModelClient;
  /** The clock. Tests pass a fixed one. */
  now?: () => Date;
  /** One line per notable thing. Never holds the brief or the answer's text. */
  log?: (entry: Record<string, unknown>) => void;
}

export interface AnalysisRequest {
  from?: string;
  to?: string;
  trigger?: AnalysisTrigger;
}

// What the brief is built from: the plan, the device events behind the single line of attention,
// and the body's side of the day. Conversations, memories, notes, meals and prompts are never read.
const TYPES: EventType[] = [
  "calendar_event",
  "app_usage",
  "web_visit",
  "search",
  "screen",
  "notification",
  "ai_session",
  "sleep",
  "recovery",
  "workout",
];
const WEEK_MS = 7 * DAY;

/**
 * Every event the brief needs in the window, a week at a time side by side. `readAllEvents` pages
 * past the store's row cap, so a busy week never silently loses its most recent days.
 */
export async function loadEvents(
  store: Pick<Store, "listEvents">,
  from: string,
  to: string,
): Promise<Event[]> {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const chunks: Promise<Event[]>[] = [];
  for (let t = start; t < end; t += WEEK_MS) {
    chunks.push(readAllEvents((filter) => store.listEvents(filter), t, Math.min(end, t + WEEK_MS), TYPES));
  }
  const byId = new Map<string, Event>();
  for (const chunk of await Promise.all(chunks)) for (const e of chunk) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
}

interface Checked {
  enforced: Enforced;
  violations: CopyViolation[];
  /** Actions the code had to drop: the text may now describe a change that was not made. */
  dropped: Correction[];
  reply: ModelReply;
}

function check(reply: ModelReply, context: BriefContext): Checked {
  const enforced = enforce(parseAnswer(reply.text), context);
  return {
    enforced,
    violations: lintCopy(enforced, context.actionsAre),
    dropped: enforced.corrections.filter((c) => c.kind === "action_dropped"),
    reply,
  };
}

const problems = (c: Checked) => c.violations.length + c.dropped.length;

/** The second and last request: the same brief, the first answer, and exactly what was wrong. */
function retryMessage(user: string, first: Checked): string {
  return [
    user,
    "",
    "You already answered this brief once. That answer cannot be shown as it is:",
    ...first.violations.map(
      (v) => `- ${v.where} breaks a copy rule: ${v.rule}. Found: ${JSON.stringify(v.found)}`,
    ),
    ...first.dropped.map(
      (d) =>
        `- ${d.where} was not allowed: ${d.detail}. Set it to null and give the advice in words, without saying you did it, or choose an action that is allowed.`,
    ),
    "Write the answer again. Keep the findings and the numbers. Change only what is listed. Answer with the JSON only.",
    "",
    "Your first answer:",
    first.reply.text,
  ].join("\n");
}

export async function runAnalysis(request: AnalysisRequest, deps: AnalysisDeps): Promise<AnalysisResult> {
  const { store, model } = deps;
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const clock = (deps.now ?? (() => new Date()))();
  const zone = new Zone(DEFAULT_TIMEZONE);
  const trigger = request.trigger ?? "manual";

  // Default: today so far, in the user's timezone.
  const to = request.to ?? clock.toISOString();
  const from = request.from ?? new Date(zone.startOfDay(zone.dayOf(Date.parse(to) - 1))).toISOString();
  // A range that ended in the past is read as it stood then, so a day can be run again later.
  const now = new Date(Math.min(clock.getTime(), Date.parse(to))).toISOString();

  let brief: ReturnType<typeof buildBrief>;
  try {
    const window = briefWindow({ from, to, now });
    const [events, goals, recommendations, asked, instructions] = await Promise.all([
      loadEvents(store, window.from, window.to),
      store.listGoals(),
      store.listRecommendations(),
      store.listAnalysisQuestions(5),
      // The person's ground rules (/v1/instructions). A failed read must not stop the run: the
      // brief then carries an empty list, as it did before the table existed.
      store.listInstructions().catch(() => []),
    ]);
    brief = buildBrief({
      events,
      goals,
      recommendations,
      from,
      to,
      now,
      trigger,
      // Active ones only, in the person's own words. A paused instruction protects nothing.
      instructions: instructions.filter((i) => i.active).map((i) => i.text),
      // Nothing is carried out on a run: every action waits for the person's tap (the execute
      // route). When a run starts applying actions itself, this becomes "applied".
      actionsAre: "offers",
      asked,
    });
  } catch (err) {
    if (err instanceof RangeError) throw new HttpError("bad_request", `Bad range: ${err.message}`);
    throw err;
  }

  const user = renderUserMessage(brief.brief);
  const base = {
    system: COACH_INSTRUCTIONS,
    schema: ANSWER_JSON_SCHEMA as unknown as Record<string, unknown>,
  };
  const started = clock.toISOString();
  const finished = () => (deps.now ? deps.now() : new Date()).toISOString();
  const runBase: Omit<AnalysisRun, "id" | "status" | "summary" | "error" | "finished_at" | "model"> = {
    trigger,
    range_start: from,
    range_end: to,
    question: null,
    started_at: started,
  };

  let chosen: Checked;
  try {
    const first = check(await model.complete({ ...base, user }), brief.context);
    log({
      event: "analysis_model_call",
      attempt: 1,
      model: first.reply.model,
      usage: first.reply.usage ?? null,
    });
    chosen = first;
    if (problems(first) > 0) {
      // One more try, told exactly what was wrong. If it fails or is no better, the first stands.
      try {
        const second = check(
          await model.complete({ ...base, user: retryMessage(user, first) }),
          brief.context,
        );
        log({
          event: "analysis_model_call",
          attempt: 2,
          model: second.reply.model,
          usage: second.reply.usage ?? null,
        });
        if (problems(second) <= problems(first)) chosen = second;
      } catch (err) {
        log({ event: "analysis_retry_failed", reason: err instanceof Error ? err.message : "unknown" });
      }
    }
  } catch (err) {
    if (!(err instanceof ModelError) && !(err instanceof AnswerError)) throw err;
    const { run } = await store.saveAnalysis({
      run: {
        ...runBase,
        status: "failed",
        model: model.model,
        summary: null,
        error: err.message,
        finished_at: finished(),
      },
      recommendations: [],
    });
    log({ event: "analysis_failed", run_id: run.id, reason: err.message });
    throw new HttpError("upstream_error", `The analysis failed: ${err.message}`, { run_id: run.id });
  }

  const { enforced } = chosen;
  const saved = await store.saveAnalysis({
    run: {
      ...runBase,
      status: "succeeded",
      model: chosen.reply.model,
      summary: enforced.summary,
      question: enforced.question,
      error: null,
      finished_at: finished(),
    },
    recommendations: enforced.recommendations,
  });
  if (enforced.corrections.length > 0 || chosen.violations.length > 0) {
    // Stored anyway: a brief with a stray dash beats no brief. The log says what to fix.
    log({
      event: "analysis_answer_corrected",
      run_id: saved.run.id,
      corrections: enforced.corrections,
      copy_violations: chosen.violations,
    });
  }
  return saved;
}
