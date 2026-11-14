import assert from "node:assert/strict";
import { test } from "node:test";
import { AnalysisResult, type AnalysisSpecialist, mockEvents, mockGoals } from "@michael/shared";
import { runAsUser } from "../context";
import { MemoryStore } from "../store";
import { COACH_INSTRUCTIONS } from "./coach";
import { type ModelClient, ModelError, type ModelReply, type ModelRequest } from "./model";
import { inventedNumbers, knownNumbers } from "./numbers";
import { prepareBrief } from "./run";
import {
  COORDINATOR_INSTRUCTIONS,
  checkFindings,
  type Finding,
  mergeFindings,
  runSpecialistAnalysis,
  SPECIALISTS,
  sliceBrief,
  specialistInstructions,
  specialistOf,
} from "./specialists";

// The specialists and the coordinator against the in-memory store (the mock day, Saturday 14
// November 2026) and a model that answers by role: each specialist from its own script, the
// coordinator from another. No network.
//
// At 10:00 the 18:00 gym block has not started, so it is the brief's only movable block, "b1".

const NOW = "2026-11-14T10:00:00+02:00";
const clock = () => new Date(NOW);
const GOAL = {
  work: "10000000-0000-4000-8000-000000000001",
  gym: "10000000-0000-4000-8000-000000000002",
  sleep: "10000000-0000-4000-8000-000000000003",
  fun: "10000000-0000-4000-8000-000000000005",
};

type Script = (string | Error)[];

/** Answers by system prompt. Records every request with the role that made it. */
class RoleModel implements ModelClient {
  readonly model = "fake-model";
  readonly calls: { role: string; request: ModelRequest }[] = [];
  private readonly used = new Map<string, number>();

  constructor(
    private readonly scripts: Partial<Record<AnalysisSpecialist | "coordinator" | "single", Script>>,
  ) {}

  async complete(request: ModelRequest): Promise<ModelReply> {
    const role =
      request.system === COORDINATOR_INSTRUCTIONS
        ? "coordinator"
        : request.system === COACH_INSTRUCTIONS
          ? "single"
          : (SPECIALISTS.find((s) => request.system === specialistInstructions(s)) ?? "unknown");
    this.calls.push({ role, request });
    const script = this.scripts[role as keyof typeof this.scripts] ?? [JSON.stringify({ findings: [] })];
    const n = this.used.get(role) ?? 0;
    this.used.set(role, n + 1);
    const next = script[Math.min(n, script.length - 1)];
    if (next instanceof Error) throw next;
    return { text: next ?? "", model: this.model };
  }

  roles = () => this.calls.map((c) => c.role);
}

const action = (over: Record<string, unknown>) => ({
  kind: "reminder",
  block: null,
  day: "2026-11-14",
  start: null,
  end: null,
  app: null,
  text: null,
  ...over,
});

const finding = (over: Record<string, unknown>) => ({
  finding: "Something with a number.",
  maths: "",
  evidence_numbers: [],
  goal_id: null,
  confidence: 0.5,
  evidence: ["plan"],
  action: null,
  ...over,
});

const findings = (...list: Record<string, unknown>[]) => JSON.stringify({ findings: list });

// Every number here is in the brief: work has 0 of 1200 minutes planned, training 60 of 540 with
// 480 not yet planned, the gym block is at 18:00, evenings out have a budget of 180.
const WORK = findings(
  finding({
    finding: "Deep work has 0 of its 1200 minutes planned this week.",
    maths: "budget 1200, planned 0",
    evidence_numbers: ["1200", "0"],
    goal_id: GOAL.work,
    confidence: 0.9,
    action: action({ kind: "create_focus_block", start: "12:00", end: "14:00", text: "Deep work" }),
  }),
);
const TRAINING = findings(
  finding({
    finding: "Training has 60 of its 540 minutes planned. 480 still unplanned.",
    maths: "budget 540, planned 60, not yet planned 480",
    evidence_numbers: ["540", "60", "480"],
    goal_id: GOAL.gym,
    confidence: 0.7,
    action: action({ kind: "move_calendar_block", block: "b1", start: "21:00", end: "22:00" }),
  }),
);
const REST = findings(
  finding({
    finding: "Evenings out have a budget of 180 minutes and the night needs protecting.",
    maths: "budget 180",
    evidence_numbers: ["180"],
    goal_id: GOAL.fun,
    confidence: 0.65,
    action: action({ start: "21:30", text: "Screens off. Wind down." }),
  }),
);

const rec = (over: Record<string, unknown>) => ({
  goal_id: null,
  title: "A headline with 60 minutes.",
  rationale: "The maths and the fix.",
  action: null,
  evidence: ["plan"],
  finding: null,
  ...over,
});
const coordinator = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    summary: "Training has 60 of its 540 minutes this week. Deep work has 0 of 1200 planned.",
    recommendations: [
      rec({
        goal_id: GOAL.work,
        title: "Deep work has 0 of its 1200 minutes planned.",
        rationale: "I can put a block in from 12:00 to 14:00. One tap.",
        action: action({ kind: "create_focus_block", start: "12:00", end: "14:00", text: "Deep work" }),
        finding: "w1",
      }),
      rec({
        goal_id: GOAL.fun,
        title: "The night needs protecting.",
        rationale: "A reminder at 21:30 to wind down. One tap.",
        action: action({ start: "21:30", text: "Screens off. Wind down." }),
        finding: "r1",
      }),
      rec({
        goal_id: GOAL.gym,
        title: "Training has 480 minutes still unplanned.",
        rationale: "The 18:00 session stays where it is. The night comes first.",
        // The coordinator tries to give the loser of the conflict its time back.
        action: action({ kind: "move_calendar_block", block: "b1", start: "21:00", end: "22:00" }),
        finding: "t1",
      }),
      rec({ title: "A fourth one with 60 minutes.", finding: null }),
    ],
    question: null,
    ...over,
  });

async function run(model: RoleModel, user: string = crypto.randomUUID()) {
  const store = new MemoryStore();
  const logs: Record<string, unknown>[] = [];
  const result = await runAsUser(user, () =>
    runSpecialistAnalysis(
      { trigger: "morning" },
      { store, model, now: clock, log: (entry) => logs.push(entry) },
    ),
  );
  return { result: AnalysisResult.parse(result), logs, store };
}

// ---------- slicing ----------

test("goals go to the specialist of their domain", () => {
  const by = Object.fromEntries(mockGoals.map((g) => [g.title, specialistOf(g)]));
  assert.equal(by["4h of deep work per day"], "work");
  assert.equal(by["70.3 training: 9 hours this week"], "training");
  assert.equal(by["Sleep 7.5h+"], "rest");
  assert.equal(by["High-protein meals"], "food");
  assert.equal(by["Evenings out"], "rest");
});

test("each specialist reads only its own goals, blocks and patterns, and food with nothing is not asked", async () => {
  const store = new MemoryStore();
  await runAsUser(crypto.randomUUID(), async () => {
    const { brief } = await prepareBrief({ trigger: "morning" }, { store, now: clock });
    const goals = await store.listGoals();
    const work = sliceBrief(brief.brief, "work", goals);
    const training = sliceBrief(brief.brief, "training", goals);
    assert.ok(work && training);
    const workText = JSON.stringify(work);
    const trainingText = JSON.stringify(training);
    assert.ok(workText.includes(GOAL.work) && !workText.includes(GOAL.gym));
    assert.ok(trainingText.includes(GOAL.gym) && !trainingText.includes(GOAL.work));
    assert.ok(trainingText.includes("Gym: upper body"), "training sees its own block");
    assert.ok(!workText.includes("Gym: upper body"), "work does not see the gym block");
    assert.ok(!trainingText.includes("time_by_app"), "training gets no screen patterns");
    assert.ok(!workText.includes("already_recommended"), "slices stay the same after a run");
    // The protein goal is a daily target with no blocks and no patterns: nothing to read.
    assert.equal(sliceBrief(brief.brief, "food", goals), null);
  });
});

// ---------- merge, conflict, cap ----------

const f = (over: Partial<Finding>): Finding => ({
  ref: "w1",
  specialist: "work",
  finding: "A finding.",
  maths: "",
  evidence_numbers: [],
  goal_id: null,
  confidence: 0.5,
  evidence: ["plan"],
  action: null,
  checked: null,
  notes: [],
  ...over,
});
const at = (start: string, end?: string) => ({
  kind: "create_focus_block" as const,
  payload: { start_at: start, ...(end ? { end_at: end } : {}) },
  involves_others: false,
  undo_until: start,
});

test("merge drops duplicates and keeps the evidence of both", () => {
  const merged = mergeFindings([
    f({ ref: "w1", finding: "WhatsApp opened 37 times.", confidence: 0.8, evidence: ["phone_cadence"] }),
    f({
      ref: "r1",
      specialist: "rest",
      finding: "whatsapp opened 37 times",
      confidence: 0.4,
      evidence: ["late_screens"],
    }),
  ]);
  assert.deepEqual(
    merged.candidates.map((c) => c.ref),
    ["w1"],
  );
  assert.deepEqual(merged.candidates[0]?.evidence, ["phone_cadence", "late_screens"]);
  assert.deepEqual(merged.duplicates, [{ kept: "w1", dropped: "r1" }]);
});

test("conflict: when training and rest want the same time and are close, rest keeps it", () => {
  const merged = mergeFindings([
    f({
      ref: "t1",
      specialist: "training",
      finding: "Run late.",
      confidence: 0.7,
      checked: at("2026-11-14T19:00:00Z", "2026-11-14T20:00:00Z"),
    }),
    f({
      ref: "r1",
      specialist: "rest",
      finding: "Protect the night.",
      confidence: 0.65,
      checked: at("2026-11-14T19:30:00Z"),
    }),
  ]);
  const t1 = merged.candidates.find((c) => c.ref === "t1");
  const r1 = merged.candidates.find((c) => c.ref === "r1");
  assert.equal(t1?.checked, null, "training gave way");
  assert.ok(r1?.checked);
  assert.match(t1?.notes[0] ?? "", /gave way/);
  assert.deepEqual(merged.conflicts, [
    { winner: "r1", loser: "t1", reason: "confidences are close and rest comes before training" },
  ]);
});

test("conflict: a clearly higher confidence wins whatever the domain", () => {
  const merged = mergeFindings([
    f({
      ref: "t1",
      specialist: "training",
      finding: "Run late.",
      confidence: 0.9,
      checked: at("2026-11-14T19:00:00Z", "2026-11-14T20:00:00Z"),
    }),
    f({
      ref: "r1",
      specialist: "rest",
      finding: "Protect the night.",
      confidence: 0.5,
      checked: at("2026-11-14T19:30:00Z"),
    }),
  ]);
  assert.equal(merged.conflicts[0]?.winner, "t1");
  assert.equal(merged.candidates.find((c) => c.ref === "r1")?.checked, null);
});

test("merge ranks by confidence and caps what the coordinator sees", () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    f({ ref: `w${i + 1}`, finding: `Finding number ${i}.`, confidence: i / 10 }),
  );
  const merged = mergeFindings(many);
  assert.equal(merged.candidates.length, 6);
  assert.equal(merged.candidates[0]?.ref, "w9");
});

// ---------- the number guard ----------

test("the number guard allows the inputs and their conversions, nothing else", () => {
  const known = knownNumbers(['{"spent_minutes": 135, "share": 0.42, "sleep_hours": 7.5, "start": "18:00"}']);
  assert.deepEqual(inventedNumbers("135 minutes, or 2h 15, or 2.3 hours.", known), []);
  assert.deepEqual(inventedNumbers("42% of it. 450 minutes of sleep. The 18:00 block.", known), []);
  assert.deepEqual(inventedNumbers("WhatsApp opened 37 times at 07:00.", known), ["07:00", "37"]);
  assert.deepEqual(
    inventedNumbers("I can move it to 07:00.", known, ["07:00"]),
    [],
    "a proposed time is fine",
  );
});

test("a specialist finding with a number that is not in its slice is dropped whole", () => {
  const ctx = {
    timezone: "Europe/Athens",
    now: Date.parse(NOW),
    goalIds: new Set([GOAL.work]),
    blocks: new Map(),
    goalBlocks: [],
    busy: [],
    blockTitles: new Map(),
    patterns: new Set<string>(),
    actionsAre: "offers" as const,
  };
  const out = checkFindings(
    "work",
    [
      finding({ finding: "Deep work has 0 of 1200 minutes.", goal_id: GOAL.work }),
      finding({ finding: "Slack took 47 minutes.", goal_id: GOAL.gym }),
    ] as never,
    ctx,
    new Set([GOAL.work]),
    knownNumbers(['{"weekly_budget_minutes": 1200}']),
  );
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0]?.goal_id, GOAL.work);
  assert.match(out.dropped[0]?.reason ?? "", /47/);
});

// ---------- the whole run ----------

test("specialists run in parallel at low effort, the coordinator merges, caps at 3 and keeps the conflict settled", async () => {
  const model = new RoleModel({
    work: [WORK],
    training: [TRAINING],
    rest: [REST],
    coordinator: [coordinator()],
  });
  const { result, logs } = await run(model);

  // Three specialists with something to read, then the coordinator. Food had nothing.
  assert.deepEqual(model.roles().slice(0, 3).sort(), ["rest", "training", "work"]);
  assert.equal(model.roles()[3], "coordinator");
  assert.equal(model.calls.length, 4, "no retry when the answer is clean");
  for (const c of model.calls.slice(0, 3)) assert.equal(c.request.effort, "low");
  assert.equal(model.calls[3]?.request.effort, undefined, "the coordinator thinks at the default");

  // The coordinator saw the merged findings and the conflict the code settled.
  const user = model.calls[3]?.request.user ?? "";
  assert.match(user, /"specialist_findings"/);
  assert.match(user, /"winner": "r1",\s*"loser": "t1"/);
  for (const e of mockEvents) assert.ok(!user.includes(e.id), "an event id reached the model");

  assert.equal(result.run.status, "succeeded");
  assert.equal(
    result.run.summary,
    "Training has 60 of its 540 minutes this week. Deep work has 0 of 1200 planned.",
  );
  assert.equal(result.recommendations.length, 3, "capped at 3");
  assert.deepEqual(
    result.recommendations.map((r) => r.specialist),
    ["work", "rest", "training"],
  );
  assert.equal(result.recommendations[0]?.action?.kind, "create_focus_block");
  assert.equal(result.recommendations[1]?.action?.kind, "reminder");
  assert.equal(
    result.recommendations[2]?.action,
    null,
    "the loser of the conflict does not get its time back",
  );
  assert.ok(logs.some((l) => l.event === "analysis_action_withheld"));
});

test("an invented number sends the coordinator back once, told which number", async () => {
  const bad = coordinator({ summary: "We lost 37 minutes to WhatsApp. Deep work has 0 of 1200 planned." });
  const model = new RoleModel({
    work: [WORK],
    training: [TRAINING],
    rest: [REST],
    coordinator: [bad, coordinator()],
  });
  const { result } = await run(model);
  const retry = model.calls.filter((c) => c.role === "coordinator")[1]?.request.user ?? "";
  assert.match(retry, /summary breaks a copy rule: every number and time must be in the brief/);
  assert.match(retry, /Found: "37"/);
  assert.equal(
    result.run.summary,
    "Training has 60 of its 540 minutes this week. Deep work has 0 of 1200 planned.",
  );
});

test("a summary that still invents a number after the retry falls back to the single pass", async () => {
  const bad = coordinator({ summary: "We lost 37 minutes to WhatsApp." });
  const single = JSON.stringify({
    summary: "Training has 60 of its 540 minutes this week.",
    recommendations: [],
    question: null,
  });
  const model = new RoleModel({
    work: [WORK],
    training: [TRAINING],
    rest: [REST],
    coordinator: [bad],
    single: [single],
  });
  const { result, logs } = await run(model);
  assert.equal(model.roles().at(-1), "single");
  assert.equal(result.run.summary, "Training has 60 of its 540 minutes this week.");
  assert.ok(logs.some((l) => l.event === "analysis_specialists_fallback"));
});

test("a recommendation with an invented number is dropped, the rest stand", async () => {
  const answer = coordinator();
  const parsed = JSON.parse(answer);
  parsed.recommendations[1].title = "The night lost 95 minutes.";
  const model = new RoleModel({
    work: [WORK],
    training: [TRAINING],
    rest: [REST],
    coordinator: [JSON.stringify(parsed)],
  });
  const { result } = await run(model);
  assert.deepEqual(
    result.recommendations.map((r) => r.specialist),
    ["work", "training"],
  );
});

test("when one specialist fails, the run falls back to the single pass on the same brief", async () => {
  const single = JSON.stringify({
    summary: "Deep work has 0 of 1200 minutes planned.",
    recommendations: [],
    question: null,
  });
  const model = new RoleModel({
    work: [WORK],
    training: [new ModelError("api", "the model API timed out")],
    rest: [REST],
    single: [single],
  });
  const { result, logs } = await run(model);
  assert.equal(result.run.status, "succeeded");
  assert.equal(result.run.summary, "Deep work has 0 of 1200 minutes planned.");
  assert.ok(!model.roles().includes("coordinator"));
  const fallback = logs.find((l) => l.event === "analysis_specialists_fallback");
  assert.match(String(fallback?.reason), /training specialist: the model API timed out/);
});

test("the same slices on the same day are answered from the cache", async () => {
  const user = crypto.randomUUID();
  const model = new RoleModel({
    work: [WORK],
    training: [TRAINING],
    rest: [REST],
    coordinator: [coordinator()],
  });
  const store = new MemoryStore();
  const go = () =>
    runAsUser(user, () =>
      runSpecialistAnalysis({ trigger: "morning" }, { store, model, now: clock, log: () => {} }),
    );
  await go();
  await go();
  const specialists = model.roles().filter((r) => r !== "coordinator");
  assert.equal(specialists.length, 3, "the second run asked no specialist");
  assert.equal(model.roles().filter((r) => r === "coordinator").length, 2);
});
