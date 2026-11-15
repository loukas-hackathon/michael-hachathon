import {
  type CheckIn,
  type EventType,
  type Insight,
  type InsightsResponse,
  type Recommendation,
  voiceShortDuration,
} from "@michael/shared";
import { undoRecommendation } from "../actions/calendar";
import { type ModelClient, ModelNotConfiguredError, modelClient } from "../analysis/model";
import { currentUserId } from "../context";
import { bookGoalTime } from "../goals/book";
import { HttpError } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { createInstruction, sameInstruction } from "../routes/instructions";
import { eventsByDay } from "../routes/patterns";
import { store } from "../store";
import { featureDef } from "./dictionary";
import { InsightRun, runDiscovery, type StoredDiscovery } from "./discover";
import { canonical } from "./hypothesis";
import {
  buildInsights,
  type FeatureTable,
  type FixPlan,
  MINER_RULES,
  pickInsight,
  type Study,
  withDiscoveries,
} from "./index";

// The one place that reads the clock and the store for the insights; everything under it is pure.
//
// The study reads 12 weeks of events, so it is worked out at most once every ten minutes per user
// and kept in the process (one API instance, railway.json). A read past that age is answered at
// once with what is there while a new study runs behind it, so no screen ever waits on it twice.
// Whether a fix is applied is never kept here: it is read from the user's standing instructions
// and booked blocks on every read, so it is right the moment they change.

export const STUDY = {
  /** How far back Michael studies. */
  days: 84,
  freshMs: 10 * 60_000,
  /** With little data a study is cheap and changes fast (the first days after connecting). */
  earlyFreshMs: 30_000,
} as const;

// What the daily table is made of. Conversations, memories, notes on people, searches and
// prompts are never read.
const TYPES: EventType[] = [
  "sleep",
  "recovery",
  "biometric",
  "workout",
  "calendar_event",
  "app_usage",
  "web_visit",
  "screen",
  "ai_session",
  "meal",
  // The user's own word on a block (score/logged.ts) and place visits that prove one.
  "focus_session",
  "note",
  "location",
];

interface Entry {
  at: number;
  value: Promise<Study>;
  /** The last study that finished, served while a newer one runs. */
  ready: Study | null;
  refreshing: boolean;
}

const studies = new Map<string, Entry>();

async function compute(): Promise<Study> {
  const nowMs = Date.now();
  const zone = new Zone(DEFAULT_TIMEZONE);
  const today = zone.dayOf(nowMs);
  const from = zone.startOfDay(zone.nextDay(today, -STUDY.days));
  const [events, goals, checkIns, run] = await Promise.all([
    eventsByDay(from, nowMs, { type: TYPES }),
    store.listGoals(),
    store
      .listCheckIns({ fromDay: zone.dayOf(from), toDay: today })
      .catch((): Pick<CheckIn, "day" | "kind" | "answer">[] => []),
    storedRun(),
  ]);
  return buildInsights(
    {
      events,
      goals,
      checkIns,
      from: new Date(from).toISOString(),
      to: new Date(nowMs).toISOString(),
      now: new Date(nowMs).toISOString(),
    },
    // The tests the discovery pass kept, run again on today's table.
    run?.discoveries ?? [],
  );
}

/** The user's last discovery pass, when it reads as one. A failed read is no pass. */
async function storedRun(): Promise<InsightRun | null> {
  const parsed = InsightRun.safeParse(await store.getInsightRun().catch(() => null));
  return parsed.success ? parsed.data : null;
}

const freshFor = (study: Study) =>
  study.response.studied.days < MINER_RULES.minDays ? STUDY.earlyFreshMs : STUDY.freshMs;

/** The current user's study: the kept one while it is fresh, else a new one. */
export function studyFor(): Promise<Study> {
  const userId = currentUserId();
  const hit = studies.get(userId);
  const start = (): Entry => {
    const entry: Entry = { at: Date.now(), value: compute(), ready: hit?.ready ?? null, refreshing: true };
    entry.value.then(
      (study) => {
        entry.ready = study;
        entry.refreshing = false;
      },
      () => {
        // A failed study is never kept: the next read tries again (or keeps the one before it).
        if (studies.get(userId) === entry) {
          if (hit?.ready) studies.set(userId, { ...hit, refreshing: false });
          else studies.delete(userId);
        }
      },
    );
    studies.set(userId, entry);
    return entry;
  };
  if (!hit) return start().value;
  if (hit.refreshing || !hit.ready) return hit.ready ? Promise.resolve(hit.ready) : hit.value;
  if (Date.now() - hit.at < freshFor(hit.ready)) return Promise.resolve(hit.ready);
  // Past its age: answer with what is there, and study again behind it.
  const stale = hit.ready;
  start().value.catch(() => undefined);
  return Promise.resolve(stale);
}

/** The kept study, if there is one. Never reads an event and never starts a study. */
export const keptStudy = (): Study | null => studies.get(currentUserId())?.ready ?? null;

/** Forget the kept study of the current user (or of everyone): tests, and after a forced run. */
export function forgetStudy(everyone = false): void {
  if (everyone) {
    studies.clear();
    checkedAhead.clear();
  } else {
    studies.delete(currentUserId());
    checkedAhead.delete(currentUserId());
  }
}

// ---------- the discovery pass ----------

/** Tests kept per user at most: every one is run again on every study. */
const MAX_STORED = 12;
/** Users with a pass in flight, so a second tap does not start a second one. */
const discovering = new Set<string>();
/** The data day each user's study was last checked ahead for, so the scheduler asks the store once. */
const checkedAhead = new Map<string, string>();

/** The last local day that has any reading. */
const lastDataDay = (table: FeatureTable): string | null => {
  for (let i = table.days.length - 1; i >= 0; i--) {
    if (Object.values(table.cols).some((col) => col[i] !== null && col[i] !== undefined)) {
      return table.days[i] ?? null;
    }
  }
  return null;
};

/** The model for the pass, or null when this server has no key: the rules still work without it. */
function discoveryModel(): ModelClient | null {
  try {
    return modelClient();
  } catch (err) {
    if (err instanceof ModelNotConfiguredError) return null;
    throw err;
  }
}

/** One pass on a study: propose, verify, write, store, and show it in the kept study. */
async function discover(study: Study, model: ModelClient): Promise<void> {
  const userId = currentUserId();
  const before = (await storedRun())?.discoveries ?? [];
  let found: StoredDiscovery[] = [];
  let by: string | null = model.model;
  try {
    const result = await runDiscovery(
      {
        table: study.table,
        minerPs: study.minerPs,
        found: study.rules.map((p) => p.insight),
        stories: study.stories,
        goals: study.goals,
      },
      model,
    );
    found = result.discoveries;
    by = result.model;
    console.log(`[insights] discovery: ${result.proposed} proposed, ${result.verified} verified`);
  } catch (err) {
    // The day is still marked as studied, so a failing model is not asked again every tick.
    console.warn("[insights] discovery pass failed", err instanceof Error ? err.message : err);
  }
  // What was found before stays while it still holds: each test is run again on every study.
  const byKey = new Map<string, StoredDiscovery>();
  for (const d of [...found, ...before])
    if (!byKey.has(canonical(d.hypothesis))) byKey.set(canonical(d.hypothesis), d);
  const discoveries = [...byKey.values()].slice(0, MAX_STORED);
  const run: InsightRun = {
    ran_at: new Date().toISOString(),
    data_day: lastDataDay(study.table),
    model: by,
    discoveries,
  };
  await store.saveInsightRun(run);
  const entry = studies.get(userId);
  if (entry?.ready) {
    entry.ready = withDiscoveries(entry.ready, discoveries);
    entry.value = Promise.resolve(entry.ready);
  }
}

export type RunStatus = "started" | "running" | "skipped";

/**
 * POST /v1/insights/run: study again now, then run the discovery pass behind the answer.
 * `skipped` when the server has no model key (the rules' insights are still refreshed), `running`
 * when a pass is already in flight. `done` settles when the pass has: tests wait on it.
 */
export async function runInsights(): Promise<{ status: RunStatus; done: Promise<void> }> {
  const userId = currentUserId();
  if (discovering.has(userId)) return { status: "running", done: Promise.resolve() };
  forgetStudy();
  const study = await studyFor();
  const model = discoveryModel();
  if (!model) return { status: "skipped", done: Promise.resolve() };
  discovering.add(userId);
  const done = discover(study, model)
    .catch((err) => console.error("[insights] discovery pass failed", err))
    .finally(() => discovering.delete(userId));
  return { status: "started", done };
}

/**
 * The scheduler's slow beat, per active user: make sure a study from today is kept (so a nudge
 * can cite it and the screen opens at once), and run the discovery pass behind it when the user
 * has a new day of data since the last one. Cheap when there is nothing new: no event is read.
 */
export async function studyAhead(now = Date.now()): Promise<void> {
  const userId = currentUserId();
  const today = new Zone(DEFAULT_TIMEZONE).dayOf(now);
  const kept = keptStudy();
  const keptDay = kept ? new Zone(DEFAULT_TIMEZONE).dayOf(Date.parse(kept.response.generated_at)) : null;
  const study = kept && keptDay === today ? kept : await studyFor();
  const dataDay = lastDataDay(study.table);
  if (!dataDay || checkedAhead.get(userId) === dataDay || discovering.has(userId)) return;
  checkedAhead.set(userId, dataDay);
  if (study.response.studied.days < MINER_RULES.minDays) return;
  if ((await storedRun())?.data_day === dataDay) return;
  const model = discoveryModel();
  if (!model) return;
  discovering.add(userId);
  void discover(study, model)
    .catch((err) => console.error("[insights] discovery pass failed", err))
    .finally(() => discovering.delete(userId));
}

// ---------- the one tap fix ----------

const bookedFor = (plan: Extract<FixPlan, { kind: "focus_block" }>, recs: Recommendation[], now: number) =>
  recs.find(
    (r) =>
      r.status === "done" &&
      r.action?.kind === "create_focus_block" &&
      r.goal_id === plan.goal_id &&
      Date.parse(String(r.action.payload.start_at)) > now,
  ) ?? null;

/** When each fix was applied, read from what it made: the instruction, or a block still ahead. */
async function appliedAt(plans: Map<string, FixPlan>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (plans.size === 0) return out;
  const all = [...plans.values()];
  const [instructions, recs] = await Promise.all([
    all.some((p) => p.kind === "instruction") ? store.listInstructions() : [],
    all.some((p) => p.kind === "focus_block") ? store.listRecommendations({ status: "done" }) : [],
  ]);
  const now = Date.now();
  for (const [id, plan] of plans) {
    if (plan.kind === "instruction") {
      const made = instructions.find((i) => i.active && sameInstruction(i, plan.instruction));
      if (made) out.set(id, made.created_at);
    } else {
      const rec = bookedFor(plan, recs, now);
      if (rec) out.set(id, rec.executed_at ?? rec.updated_at);
    }
  }
  return out;
}

/** GET /v1/insights: the study, with each fix's `applied_at` as it stands now. */
export async function insightsFor(): Promise<InsightsResponse> {
  const study = await studyFor();
  const applied = await appliedAt(study.plans);
  return {
    ...study.response,
    insights: study.response.insights.map((i) => ({
      ...i,
      fix: { ...i.fix, applied_at: applied.get(i.id) ?? null },
    })),
  };
}

async function planOf(id: string): Promise<{ plan: FixPlan }> {
  const study = await studyFor();
  if (!study.response.insights.some((i) => i.id === id))
    throw new HttpError("not_found", "Insight not found");
  const plan = study.plans.get(id);
  if (!plan) throw new HttpError("conflict", "This one has no one tap fix.");
  return { plan };
}

const one = async (id: string): Promise<Insight> => {
  const insight = (await insightsFor()).insights.find((i) => i.id === id);
  if (!insight) throw new HttpError("not_found", "Insight not found");
  return insight;
};

/** POST /v1/insights/:id/fix. Applying twice changes nothing the second time. */
export async function applyFix(id: string): Promise<Insight> {
  const { plan } = await planOf(id);
  if (!(await appliedAt(new Map([[id, plan]]))).has(id)) {
    if (plan.kind === "instruction") await createInstruction(plan.instruction);
    else await bookGoalTime(plan.goal_id, plan.minutes);
  }
  return one(id);
}

/** DELETE /v1/insights/:id/fix: the instruction goes; a booked block is undone like any other. */
export async function undoFix(id: string): Promise<Insight> {
  const { plan } = await planOf(id);
  if (plan.kind === "instruction") {
    for (const i of await store.listInstructions()) {
      if (i.active && sameInstruction(i, plan.instruction)) await store.deleteInstruction(i.id);
    }
  } else {
    const rec = bookedFor(plan, await store.listRecommendations({ status: "done" }), Date.now());
    if (rec) await undoRecommendation(rec.id);
  }
  return one(id);
}

// ---------- for Claude and for the chat ----------

/** What Michael has learnt, as plain text for a model to read and cite. */
export function insightsText(body: InsightsResponse): string {
  const s = body.studied;
  const head = `Studied ${s.days} days and ${s.nights} nights (${s.data_points} daily readings${s.sources.length ? ` from ${s.sources.join(", ")}` : ""}).`;
  const patterns = body.insights.filter((i) => i.status === "pattern");
  const watching = body.insights.filter((i) => i.status === "watching");
  const row = (i: Insight) =>
    [
      `- ${i.title}. ${i.line}`,
      `  Steps: ${i.steps.map((st) => `${st.label}: ${st.value}`).join("; ")}.`,
      `  Held ${i.evidence.times_held} of ${i.evidence.times_seen} times, last seen ${i.last_seen}. Found by ${i.found_by === "model" ? "a hypothesis the server verified" : "the miner"}.`,
      `  Fix: ${i.fix.text}${i.fix.action ? ` (one tap: ${i.fix.action.label}${i.fix.applied_at ? ", already applied" : ""})` : ""}`,
    ].join("\n");
  if (body.insights.length === 0) {
    return `${head}\nNothing has become a pattern yet. A pattern needs ${s.needed_days} days of data and a trigger seen ${MINER_RULES.needed} times.`;
  }
  return [
    head,
    patterns.length
      ? `Patterns (${patterns.length}), strongest first:\n${patterns.map(row).join("\n")}`
      : "No pattern yet.",
    ...(watching.length
      ? [`Still watching (${watching.length}), not yet a pattern:\n${watching.map(row).join("\n")}`]
      : []),
  ].join("\n\n");
}

// ---------- for the real time nudges ----------

/**
 * The strongest pattern about one column of the daily table for the current user, from the kept
 * study only: it never reads events and never starts a study, so it can be asked every minute.
 */
export function topInsightFor(feature: string): Insight | null {
  const study = keptStudy();
  return study ? pickInsight(study, feature) : null;
}

export interface LearntLine {
  /** A whole sentence of at most 6 words, number first where it can be. */
  line?: string;
  /** The evidence. */
  reason: string;
}

const LATE = ["late_phone_min", "phone_before_sleep_min", "late_screen_min", "bedtime_min"];
const PHONE_IN_DAY = ["phone_opens", "phone_min"];

/**
 * What Michael has learnt about a real time trigger, for a nudge to cite: the phone late at night
 * (what it costs the night or the next morning) or the phone inside a goal block (what it costs
 * the block). From the kept study only. Null when he has no pattern that starts there.
 */
export function learntAbout(trigger: "phone_block" | "late_phone"): LearntLine | null {
  const study = keptStudy();
  if (!study) return null;
  const starts = trigger === "late_phone" ? LATE : PHONE_IN_DAY;
  const insight = study.response.insights.find(
    (i) => i.status === "pattern" && starts.includes(study.features.get(i.id)?.[0] ?? ""),
  );
  if (!insight) return null;
  const reason = `Held ${insight.evidence.times_held} of ${insight.evidence.times_seen} times.`;
  const keys = study.features.get(insight.id) ?? [];
  // The cost, from the step that carries one this short: both sides as numbers, and worse.
  for (let n = 1; n < insight.steps.length; n++) {
    const step = insight.steps[n];
    const key = keys[n];
    if (!step || !key || step.value_num === undefined || step.usual_num === undefined) continue;
    const better = featureDef(key).outcome?.better;
    const gap = Math.round(Math.abs(step.value_num - step.usual_num));
    const worse = better === "high" ? step.value_num < step.usual_num : step.value_num > step.usual_num;
    if (!worse || gap <= 0) continue;
    const line =
      key === "sleep_score"
        ? `It costs you ${gap} sleep points.`
        : key === "sleep_min" || key === "deep_min"
          ? `${voiceShortDuration(gap)} less ${key === "deep_min" ? "deep sleep" : "sleep"} that night.`
          : key === "recovery"
            ? `It costs you ${gap} recovery points.`
            : key === "lost_min" || key === "first_block_lost_min"
              ? trigger === "late_phone"
                ? `It costs tomorrow's block ${gap} minutes.`
                : `It costs the block ${gap} minutes.`
              : undefined;
    if (line && line.split(/\s+/).length <= 6) return { line, reason };
  }
  return { reason };
}
