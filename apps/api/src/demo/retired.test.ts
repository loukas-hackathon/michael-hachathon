import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AnalysisRun,
  DEMO_RECOMMENDATION_IDS,
  type Goal,
  mockAnalysisRun,
  mockRecommendations,
  type Recommendation,
  type Score,
} from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { MemoryStore, store } from "../store";
import { RETIRED_GOAL_IDS, RETIRED_RECOMMENDATION_IDS, SAMPLE_MODEL_MARKER } from "./retired";
import { seedDemoWeek } from "./sync";
import { demoGoals } from "./week";

// The stage account must not show the sample day (#330): no brief "Written by gemini (mock)", no
// "Add a protein snack before the gym", no goal the Goals screen does not show. Tests run with
// DEMO_WEEK off, so the demo account starts here as it once stood in production: with the sample
// run, the sample suggestions and the sample goals in it. The seed has to take them out.

const NOW = new Date("2026-11-15T20:00:00+02:00"); // the finals, Sunday evening in Athens
const auth = { Authorization: "Bearer dev-key" };
const asDemo = <T>(fn: () => Promise<T>) => runAsUser(env.DEMO_USER_ID, fn, "api_key");
const SAMPLE_IDS = new Set(mockRecommendations.map((r) => r.id));
const SAMPLE_TITLES = new Set(mockRecommendations.map((r) => r.title));
const [FOCUS_ID, RUN_ID, SYNC_ID] = DEMO_RECOMMENDATION_IDS;

const assertClean = (recs: Recommendation[], goals: Goal[]) => {
  for (const r of recs) {
    assert.ok(!SAMPLE_IDS.has(r.id), `${r.title} is a sample suggestion`);
    assert.ok(!SAMPLE_TITLES.has(r.title), `${r.title} is a sample suggestion`);
    assert.notEqual(r.analysis_run_id, mockAnalysisRun.id, `${r.title} hangs off the sample brief`);
    assert.ok(![RUN_ID, SYNC_ID].includes(r.id as typeof RUN_ID), `${r.title} is not true on the demo week`);
  }
  assert.deepEqual(goals.map((g) => g.title).sort(), demoGoals.map((g) => g.title).sort());
  assert.ok(!goals.some((g) => /weight/i.test(g.title)));
};

test("the retired lists name the sample suggestions, the two unbacked demo ones and the weight goal", () => {
  assert.ok(mockAnalysisRun.model.includes(SAMPLE_MODEL_MARKER));
  for (const r of mockRecommendations) assert.ok(RETIRED_RECOMMENDATION_IDS.includes(r.id));
  assert.ok(RETIRED_RECOMMENDATION_IDS.includes(RUN_ID) && RETIRED_RECOMMENDATION_IDS.includes(SYNC_ID));
  assert.ok(!RETIRED_RECOMMENDATION_IDS.includes(FOCUS_ID), "the Do it card stays");
  for (const id of RETIRED_GOAL_IDS) assert.ok(!demoGoals.some((g) => g.id === id));
});

test("the seeded demo account holds no sample brief, no sample suggestion and no weight goal", async () => {
  const db = new MemoryStore();
  await asDemo(async () => {
    // As production stood: the sample run and its suggestions are there before the seed.
    assert.ok((await db.latestAnalysisRun())?.model.includes(SAMPLE_MODEL_MARKER));
    assert.ok((await db.listRecommendations()).some((r) => SAMPLE_IDS.has(r.id)));

    await seedDemoWeek(db, { overwriteGoals: true, now: NOW });
    assert.equal(await db.latestAnalysisRun(), null, "no run is left, so Today offers a fresh brief");
    const recs = await db.listRecommendations();
    assertClean(recs, await db.listGoals());
    // What stays is the Do it card and what the week itself computes (the drive).
    assert.ok(recs.some((r) => r.id === FOCUS_ID));
    for (const r of recs) assert.equal(r.analysis_run_id, null);
  });
});

test("a sample brief written again goes on the next refresh; a real brief and its suggestions stay", async () => {
  const db = new MemoryStore();
  await asDemo(async () => {
    await seedDemoWeek(db, { overwriteGoals: true, now: NOW });
    const { id: _id, ...sample } = mockAnalysisRun;
    const real: Omit<AnalysisRun, "id"> = { ...sample, model: "claude", summary: "A real brief." };
    const kept = await db.saveAnalysis({
      run: real,
      recommendations: [{ goal_id: null, title: "Real one", rationale: "From the week.", action: null }],
    });
    // An old checkout running the old seed script, or a hand, puts the sample back.
    await db.saveAnalysis({
      run: sample,
      recommendations: [{ goal_id: null, title: "Add a protein snack", rationale: "Sample.", action: null }],
    });
    assert.ok((await db.latestAnalysisRun())?.model.includes(SAMPLE_MODEL_MARKER));

    // The automatic refresh (every five minutes on demo requests), not only a full reset.
    await seedDemoWeek(db, { overwriteGoals: false, now: NOW });
    const latest = await db.latestAnalysisRun();
    assert.equal(latest?.id, kept.run.id);
    assert.equal(latest?.summary, "A real brief.");
    const recs = await db.listRecommendations();
    assert.ok(recs.some((r) => r.title === "Real one" && r.analysis_run_id === kept.run.id));
    // The sample run's suggestion is not on the list of ids: it stays, but belongs to no run.
    assert.equal(recs.find((r) => r.title === "Add a protein snack")?.analysis_run_id, null);
  });
});

test("through the API: after a reseed there is no brief to read and no sample suggestion", async () => {
  const reseed = await app.request("/v1/demo/reseed", { method: "POST", headers: auth });
  assert.equal(reseed.status, 200);
  const latest = await app.request("/v1/analysis/latest", { headers: auth });
  assert.equal(latest.status, 404);
  const { recommendations } = (await (
    await app.request("/v1/recommendations", { headers: auth })
  ).json()) as {
    recommendations: Recommendation[];
  };
  const { goals } = (await (await app.request("/v1/goals", { headers: auth })).json()) as { goals: Goal[] };
  assertClean(recommendations, goals);
});

test("the company goal counts messaging as its work: no company block loses time to it", async () => {
  const company = demoGoals.find((g) => g.title === "The company");
  assert.deepEqual(company?.target?.work_categories, ["communication"]);

  await asDemo(() => seedDemoWeek(store, { overwriteGoals: true, now: NOW }));
  let companyBlocks = 0;
  for (const date of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]) {
    const res = await app.request(`/v1/score?date=${date}&now=${encodeURIComponent(NOW.toISOString())}`, {
      headers: auth,
    });
    assert.equal(res.status, 200);
    const score = (await res.json()) as Score;
    for (const b of score.day.blocks) {
      if (b.goal_id !== company?.id) continue;
      companyBlocks++;
      const messaging = b.lost.filter((l) => l.category === "communication");
      assert.deepEqual(messaging, [], `${b.title} on ${date} calls messaging lost`);
    }
  }
  assert.ok(companyBlocks >= 4, "the week has company blocks to check");
});
