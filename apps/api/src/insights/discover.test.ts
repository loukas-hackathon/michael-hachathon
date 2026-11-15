import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { EventInput, InsightsResponse, InsightsRunResponse, voiceProblems } from "@michael/shared";
import { FakeModelClient, ModelError, useModelClient } from "../analysis/model";
import { v1Routes } from "../app";
import { runAsUser } from "../context";
import { store } from "../store";
import { discoveredInsights, discoveryBrief, InsightRun, runDiscovery } from "./discover";
import { FEATURE_KEYS, type FeatureKey, type FeatureTable } from "./features";
import { canonical, evaluate, type Hypothesis, readCondition, transformed, verify } from "./hypothesis";
import { buildInsights, storiesOf } from "./index";
import { mine } from "./miner";
import { forgetStudy, runInsights, studyAhead, studyFor } from "./service";
import { seeded } from "./stats";
import { asEvents, plantedMonth } from "./testkit";

const day = (i: number) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);

function table(n: number, cols: Partial<Record<FeatureKey, (number | null)[]>>): FeatureTable {
  const days = Array.from({ length: n }, (_, i) => day(i));
  return {
    days,
    weekdays: days.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay()),
    cols: Object.fromEntries(
      FEATURE_KEYS.map((k) => [k, cols[k] ?? new Array<number | null>(n).fill(null)]),
    ) as FeatureTable["cols"],
    cutoff: "23:00",
    usualBedtime: "00:00",
    usualWake: "07:30",
  };
}

// Sixty days in which heart rate variability drops two days after a day of three or more
// meetings: a lag the miner never tests (it looks at the same day and the next).
const next = seeded(5);
const N = 60;
const meetings = Array.from({ length: N }, () => Math.floor(next() * 5));
const hrv = Array.from({ length: N }, (_, i) =>
  i < 2 ? null : ((meetings[i - 2] ?? 0) >= 3 ? 45 : 58) + (next() - 0.5) * 8,
);
const studied = table(N, { meeting_count: meetings, hrv });
const mined = mine(studied);
const ctx = { table: studied, goals: [] };

const cond = (feature: FeatureKey, threshold: number | null, extra: Partial<Hypothesis["when"]> = {}) => ({
  feature,
  transform: "none" as const,
  op: ">=" as const,
  threshold,
  ...extra,
});
const hyp = (h: Partial<Hypothesis> & Pick<Hypothesis, "when" | "outcome">): Hypothesis => ({
  and: null,
  weekdays: null,
  lag: 0,
  direction: "lower",
  ...h,
});

const TRUE = hyp({ when: cond("meeting_count", 3), outcome: "hrv", lag: 2 });
const WRONG_LAG = hyp({ when: cond("meeting_count", 3), outcome: "hrv", lag: 0 });
const WRONG_WAY = hyp({ when: cond("meeting_count", 3), outcome: "hrv", lag: 2, direction: "higher" });

test("the miner does not see a two day lag", () => {
  assert.deepEqual([mined.links.length, mined.chains.length], [0, 0]);
});

test("grammar: lags, rolling means, streaks, a second condition and weekdays", () => {
  assert.deepEqual(transformed([1, 2, 3, 4], "lag1"), [null, 1, 2, 3]);
  assert.deepEqual(transformed([1, 2, 3, 4], "lag2"), [null, null, 1, 2]);
  assert.deepEqual(transformed([3, 6, 9, 12], "rolling3"), [null, null, 6, 9]);
  const t = table(8, {
    meeting_count: [3, 3, 0, 4, 5, 3, null, 3],
    sleep_min: [300, 480, 300, 300, 480, 300, 300, 300],
  });
  const streak = readCondition(t, cond("meeting_count", 3, { transform: "streak2" }));
  assert.deepEqual(streak?.on, [null, true, false, false, true, true, null, null]);
  // The person's own median when no threshold is given.
  assert.equal(readCondition(t, cond("meeting_count", null))?.threshold, 3);
  assert.equal(readCondition(t, cond("deep_min", 10)), null);
  // The same test written twice is one test, whatever order its weekdays came in.
  assert.equal(
    canonical(hyp({ when: cond("meeting_count", 3), weekdays: [5, 1], outcome: "hrv" })),
    canonical(hyp({ when: cond("meeting_count", 3), weekdays: [1, 5, 5], outcome: "hrv" })),
  );
  assert.equal(canonical(TRUE), "meeting_count>=3>hrv+2");
});

test("a hypothesis is read strictly: unknown columns, its own family and thin sides are no test", () => {
  assert.equal(evaluate(studied, { ...TRUE, outcome: "mood" }), null);
  assert.equal(evaluate(studied, { ...TRUE, when: { ...TRUE.when, op: "!=" } }), null);
  assert.equal(evaluate(studied, hyp({ when: cond("meeting_count", 3), outcome: "meeting_min" })), null);
  // Never seen: nothing to compare.
  assert.equal(evaluate(studied, hyp({ when: cond("meeting_count", 99), outcome: "hrv" })), null);
  assert.equal(evaluate(studied, "meetings hurt"), null);
});

test("verify: the supported hypothesis survives, the unsupported ones are dropped", () => {
  const out = verify(studied, mined.ps, [WRONG_LAG, TRUE, WRONG_WAY, { nonsense: true }, TRUE]);
  assert.deepEqual(
    out.map((v) => v.key),
    ["meeting_count>=3>hrv+2"],
  );
  const v = out[0];
  assert.ok((v?.cmp.diff ?? 0) < -8);
  assert.ok((v?.cmp.held ?? 0) / (v?.cmp.seen ?? 1) >= 0.9);
  // Too few days studied: nothing is called, however clear.
  const few = table(10, { meeting_count: meetings.slice(0, 10), hrv: hrv.slice(0, 10) });
  assert.deepEqual(verify(few, [], [TRUE]), []);
});

const GOOD_WORDS = (line: string) => ({
  key: "meeting_count>=3>hrv+2",
  title: "Heavy meeting days reach your body late",
  line,
  fix: "Keep the day after a heavy meeting day light.",
});

function input() {
  return { table: studied, minerPs: mined.ps, found: [], stories: [], goals: [] };
}

test("the pass: a good hypothesis survives with the model's words, a wrong one is dropped", async () => {
  const template = discoveredInsights(studied, mined.ps, [], [{ hypothesis: TRUE, words: null }], ctx)[0];
  assert.ok(template);
  const { times_held, times_seen } = template.phrased.insight.evidence;
  const line = `${times_held} of ${times_seen} days with 3 or more meetings were followed, two days later, by lower heart rate variability.`;
  const model = new FakeModelClient([
    JSON.stringify({
      hypotheses: [
        { ...WRONG_LAG, why: "x" },
        { ...TRUE, why: "y" },
        { ...WRONG_WAY, why: "z" },
      ],
    }),
    JSON.stringify({ items: [GOOD_WORDS(line)] }),
  ]);
  const result = await runDiscovery(input(), model);
  assert.deepEqual([result.proposed, result.verified], [3, 1]);
  assert.deepEqual(result.discoveries, [
    {
      hypothesis: TRUE,
      words: { title: GOOD_WORDS(line).title, line, fix: GOOD_WORDS(line).fix },
    },
  ]);
  // The first call thinks hard, in Michael's voice, and is given summaries only.
  assert.equal(model.requests[0]?.effort, "high");
  assert.match(model.requests[0]?.system ?? "", /You are Michael/);
  assert.match(model.requests[0]?.user ?? "", /"key": "meeting_count"/);
  // The second call is given the verified figures and nothing else to count with.
  assert.match(model.requests[1]?.user ?? "", new RegExp(`${times_held} of ${times_seen} times`));

  const shown = discoveredInsights(studied, mined.ps, [], result.discoveries, ctx)[0]?.phrased.insight;
  assert.equal(shown?.kind, "discovered");
  assert.equal(shown?.found_by, "model");
  assert.equal(shown?.status, "pattern");
  assert.equal(shown?.id, "discovered:meeting_count>=3>hrv+2");
  assert.equal(shown?.line, line);
  assert.equal(shown?.title, "Heavy meeting days reach your body late");
  assert.match(shown?.steps[1]?.value ?? "", /^\d+ ms against \d+ ms$/);
  assert.deepEqual(shown?.sources, ["google-calendar", "apple-watch"]);
});

test("a line with an invented number is replaced by the template", async () => {
  const invented = "73% of days with 3 or more meetings cost you 19 ms of heart rate variability.";
  const model = new FakeModelClient([
    JSON.stringify({ hypotheses: [{ ...TRUE, why: "y" }] }),
    JSON.stringify({ items: [GOOD_WORDS(invented)] }),
  ]);
  const result = await runDiscovery(input(), model);
  assert.equal(result.discoveries.length, 1);
  assert.equal(result.discoveries[0]?.words, null);
  const shown = discoveredInsights(studied, mined.ps, [], result.discoveries, ctx)[0]?.phrased.insight;
  assert.match(
    shown?.line ?? "",
    /^\d+ of \d+ days with 3 or more meetings gave lower heart rate variability two days later: \d+ ms against \d+ ms\.$/,
  );
  assert.doesNotMatch(shown?.line ?? "", /73|19/);
  for (const text of [shown?.title ?? "", shown?.line ?? "", shown?.fix.text ?? ""]) {
    assert.deepEqual(voiceProblems(text), [], text);
  }
  assert.doesNotMatch(shown?.title ?? ".", /\.$/);

  // Stored words whose numbers no longer match what is verified are not shown either.
  const stale = discoveredInsights(
    studied,
    mined.ps,
    [],
    [{ hypothesis: TRUE, words: { ...GOOD_WORDS(invented) } }],
    ctx,
  )[0]?.phrased.insight;
  assert.equal(stale?.line, shown?.line);

  // Words that break the voice are refused the same way.
  const loud = new FakeModelClient([
    JSON.stringify({ hypotheses: [{ ...TRUE, why: "y" }] }),
    JSON.stringify({
      items: [{ ...GOOD_WORDS("3 meetings - and your body pays!"), title: "Amazing find." }],
    }),
  ]);
  assert.equal((await runDiscovery(input(), loud)).discoveries[0]?.words, null);
});

test("no survivors: no second call; an unreadable answer is no hypotheses; a failed words call keeps the template", async () => {
  const none = new FakeModelClient([JSON.stringify({ hypotheses: [{ ...WRONG_LAG, why: "x" }] })]);
  assert.deepEqual((await runDiscovery(input(), none)).discoveries, []);
  assert.equal(none.requests.length, 1);

  const garbled = new FakeModelClient(["not json"]);
  assert.deepEqual((await runDiscovery(input(), garbled)).discoveries, []);

  const half = new FakeModelClient([
    JSON.stringify({ hypotheses: [{ ...TRUE, why: "y" }] }),
    new ModelError("api", "the model API timed out"),
  ]);
  assert.deepEqual((await runDiscovery(input(), half)).discoveries, [{ hypothesis: TRUE, words: null }]);
});

test("a story the rules already tell is not told again; a relation that stops holding stops showing", () => {
  const v = verify(studied, mined.ps, [TRUE])[0];
  assert.ok(v);
  const told = [{ on: v.on, ends: ["body"] }];
  assert.deepEqual(discoveredInsights(studied, mined.ps, told, [{ hypothesis: TRUE, words: null }], ctx), []);

  const flat = table(N, {
    meeting_count: meetings,
    hrv: hrv.map((x, i) => (x === null ? null : 55 + (i % 5))),
  });
  assert.deepEqual(
    discoveredInsights(flat, mine(flat).ps, [], [{ hypothesis: TRUE, words: null }], {
      table: flat,
      goals: [],
    }),
    [],
  );
});

// ---------- the plain relation leads over a discovered variant of it ----------

function lateTable(costOfSecond: number) {
  const rnd = seeded(21);
  const n = 70;
  const late = Array.from({ length: n }, () => (rnd() < 0.45 ? 35 + rnd() * 30 : rnd() * 8));
  const second = (i: number) => (late[i] ?? 0) >= 30 && (late[i - 1] ?? 0) >= 30;
  const score = Array.from({ length: n }, (_, i) =>
    i === 0 ? null : (second(i - 1) ? costOfSecond : (late[i - 1] ?? 0) >= 30 ? 74 : 84) + (rnd() - 0.5) * 6,
  );
  const t = table(n, { late_phone_min: late, sleep_score: score });
  return { t, mined: mine(t) };
}
const STREAK = hyp({
  when: cond("late_phone_min", 30, { transform: "streak2" }),
  outcome: "sleep_score",
  lag: 1,
});

test("a discovered variant of a plain relation is dropped when it tells the same story", () => {
  // A second late evening costs what a first one does.
  const { t, mined: m } = lateTable(74);
  assert.deepEqual(
    m.links.map((l) => `${l.x.key}>${l.y}`),
    ["late_phone_min>sleep_score"],
  );
  assert.equal(verify(t, m.ps, [STREAK]).length, 1, "the streak passes the bar on its own");
  assert.deepEqual(
    discoveredInsights(t, m.ps, storiesOf(m), [{ hypothesis: STREAK, words: null }], { table: t, goals: [] }),
    [],
  );
});

test("a discovered variant that hits clearly harder is shown after the plain relation, and says so", () => {
  const { t, mined: m } = lateTable(40);
  const plain = m.links[0];
  assert.equal(plain?.x.key, "late_phone_min");
  const words = { title: "Streaks are the real problem", line: "9 of 9 times it was worse.", fix: "Stop." };
  const out = discoveredInsights(t, m.ps, storiesOf(m), [{ hypothesis: STREAK, words }], {
    table: t,
    goals: [],
  });
  assert.equal(out.length, 1);
  const shown = out[0]?.phrased.insight;
  assert.equal(shown?.kind, "discovered");
  assert.equal(shown?.title, "Late phone, 2 days running hit harder");
  assert.match(shown?.line ?? "", /^\d+ of \d+ .* That is more than late phone alone\.$/);
  // Never in front of the relation it is built on.
  assert.ok((shown?.strength ?? 1) < (plain?.strength ?? 0));
  assert.deepEqual(voiceProblems(`${shown?.title}. ${shown?.line}`), []);
});

test("the brief carries summaries and goals, never an event", () => {
  const month = plantedMonth({ firstDay: "2026-10-15", days: 30, seed: 7 });
  const study = buildInsights({
    events: asEvents(month.inputs),
    goals: month.goals,
    from: "2026-10-14T21:00:00Z",
    to: month.end,
    now: month.end,
  });
  const brief = discoveryBrief(
    study.table,
    study.rules.map((p) => p.insight),
    month.goals,
  );
  const parsed = JSON.parse(brief);
  assert.ok(parsed.columns.length >= 20);
  assert.equal(parsed.already_found[0].id, study.response.insights[0]?.id);
  assert.deepEqual(parsed.goals, [{ title: "Deep work", kind: "time", weekly_minutes: 450 }]);
  assert.doesNotMatch(brief, /Instagram|WhatsApp|VS Code|Meeting"/);
});

// ---------- the route, the table and the scheduler's beat ----------

// Working days against the weekend: a weekday effect the rules never look for.
const WEEKDAYS: Hypothesis = hyp({
  when: null,
  weekdays: [1, 2, 3, 4, 5],
  outcome: "switches_per_hour",
  direction: "higher",
});

async function seedPlain(): Promise<void> {
  const first = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  const month = plantedMonth({ firstDay: first, days: 30, seed: 2, planted: false });
  const goal = await store.createGoal({
    category: "business",
    title: "Deep work",
    weekly_budget_minutes: 450,
    active: true,
  });
  await store.insertEvents(
    month.inputs.map((e) =>
      EventInput.parse(e.data?.goal_id ? { ...e, data: { ...e.data, goal_id: goal.id } } : e),
    ),
  );
  forgetStudy();
}

const get = async () => InsightsResponse.parse(await (await v1Routes.request("/insights")).json());
/** The model's answers: the weekday hypothesis, then words that use the verified count (or not). */
async function script(words?: string) {
  const study = await studyFor();
  const v = verify(study.table, study.minerPs, [WEEKDAYS])[0];
  assert.ok(v, "the weekday effect holds on this month");
  const line = words ?? `${v.cmp.held} of ${v.cmp.seen} working days switched apps more than your weekends.`;
  return new FakeModelClient([
    JSON.stringify({ hypotheses: [{ ...WEEKDAYS, why: "work is on the Mac" }] }),
    JSON.stringify({
      items: [
        {
          key: canonical(WEEKDAYS),
          title: "Working days switch more",
          line,
          fix: "Batch the small things into one slot.",
        },
      ],
    }),
  ]);
}

test("POST /v1/insights/run: skipped without a model, the rules still answer", () =>
  runAsUser(randomUUID(), async () => {
    await seedPlain();
    useModelClient(null);
    const res = await v1Routes.request("/insights/run", { method: "POST" });
    assert.equal(res.status, 202);
    assert.deepEqual(InsightsRunResponse.parse(await res.json()), { status: "skipped" });
    const body = await get();
    assert.equal(body.studied.nights, 30);
    assert.ok(body.insights.every((i) => i.found_by === "rule"));
    assert.equal(await store.getInsightRun(), null);
  }));

test("POST /v1/insights/run: the pass is stored, shown with found_by model, and private", async () => {
  const userA = randomUUID();
  try {
    await runAsUser(userA, async () => {
      await seedPlain();
      const model = await script();
      useModelClient(model);
      const { status, done } = await runInsights();
      assert.equal(status, "started");
      await done;
      assert.equal(model.requests.length, 2);

      const run = InsightRun.parse(await store.getInsightRun());
      assert.equal(run.model, "fake-model");
      assert.deepEqual(
        run.discoveries.map((d) => canonical(d.hypothesis)),
        [canonical(WEEKDAYS)],
      );
      assert.ok(run.data_day);

      // Shown at once from the kept study, and again after the process forgets it (read from the table).
      for (const fresh of [false, true]) {
        if (fresh) forgetStudy();
        const found = (await get()).insights.find((i) => i.kind === "discovered");
        assert.equal(found?.found_by, "model");
        assert.equal(found?.title, "Working days switch more");
        assert.equal(found?.id, "discovered:weekday@d12345>switches_per_hour+0");
        assert.match(found?.line ?? "", /^\d+ of \d+ working days switched apps more than your weekends\.$/);
        assert.equal(found?.fix.text, "Batch the small things into one slot.");
        assert.equal(found?.steps[0]?.label, "Working days");
        assert.match(found?.steps[1]?.value ?? "", / against /);
        assert.ok((found?.evidence.times_seen ?? 0) >= 15);
      }

      // The scheduler's beat finds nothing new for this day: no further model call.
      await studyAhead();
      assert.equal(model.requests.length, 2);
    });
    // Another user has neither the run nor the insight.
    await runAsUser(randomUUID(), async () => {
      assert.equal(await store.getInsightRun(), null);
      assert.ok((await get()).insights.every((i) => i.kind !== "discovered"));
    });
  } finally {
    useModelClient(null);
  }
});

test("a failed model call never loses the stored tests", async () => {
  try {
    await runAsUser(randomUUID(), async () => {
      await seedPlain();
      useModelClient(await script());
      await (await runInsights()).done;
      const before = InsightRun.parse(await store.getInsightRun());
      assert.equal(before.discoveries.length, 1);

      // The next pass meets a model that fails, then one that answers nonsense.
      for (const broken of [new ModelError("api", "the model API timed out"), "not json"]) {
        useModelClient(new FakeModelClient([broken]));
        const { status, done } = await runInsights();
        assert.equal(status, "started");
        await done;
        const after = InsightRun.parse(await store.getInsightRun());
        assert.deepEqual(after.discoveries, before.discoveries);
        assert.ok((await get()).insights.some((i) => i.kind === "discovered"));
      }
    });
  } finally {
    useModelClient(null);
  }
});

test("the scheduler's beat studies ahead and runs the pass once per day of data", async () => {
  try {
    await runAsUser(randomUUID(), async () => {
      await seedPlain();
      const model = await script("9 of 9 invented things happened.");
      forgetStudy();
      useModelClient(model);
      await studyAhead();
      // The pass runs behind the beat: wait for the stored run.
      for (let i = 0; i < 100 && !(await store.getInsightRun()); i++)
        await new Promise((r) => setTimeout(r, 20));
      const run = InsightRun.parse(await store.getInsightRun());
      // The invented line was refused; the test itself is kept and shown with the template.
      assert.equal(run.discoveries[0]?.words, null);
      const found = (await get()).insights.find((i) => i.kind === "discovered");
      assert.match(found?.line ?? "", /^\d+ of \d+ /);
      assert.doesNotMatch(found?.line ?? "", /invented/);
      await studyAhead();
      await studyAhead();
      assert.equal(model.requests.length, 2);
    });
  } finally {
    useModelClient(null);
  }
});

test("a demo visitor may not start a run", async () => {
  const { app } = await import("../app");
  const res = await app.request("/v1/insights/run", {
    method: "POST",
    headers: { Authorization: "Bearer dev-key", "x-michael-demo-visitor": randomUUID() },
  });
  assert.equal(res.status, 403);
});
