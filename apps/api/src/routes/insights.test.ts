import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  EventInput,
  type Goal,
  Insight,
  InsightsResponse,
  mockInsights,
  voiceProblems,
} from "@michael/shared";
import { app, v1Routes } from "../app";
import { runAsUser } from "../context";
import { HttpError } from "../http";
import { applyFix, forgetStudy, insightsText, learntAbout, topInsightFor } from "../insights/service";
import { plantedMonth } from "../insights/testkit";
import { store } from "../store";

const auth = { Authorization: "Bearer dev-key" };

/** The last 30 days up to yesterday, by the real clock: the route studies the days before now. */
function recentMonth(seed = 7) {
  const first = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  return plantedMonth({ firstDay: first, days: 30, seed });
}

/** A fresh user with the month's events and its goal; returns the goal as stored. */
async function seedMonth(): Promise<Goal> {
  const month = recentMonth();
  const stored = await store.createGoal({
    category: "business",
    title: "Deep work",
    weekly_budget_minutes: 450,
    active: true,
  });
  await store.insertEvents(
    month.inputs.map((e) =>
      EventInput.parse(e.data?.goal_id ? { ...e, data: { ...e.data, goal_id: stored.id } } : e),
    ),
  );
  forgetStudy();
  return stored;
}

const asUser = <T>(fn: () => Promise<T>) => runAsUser(randomUUID(), fn);
const get = async () => InsightsResponse.parse(await (await v1Routes.request("/insights")).json());

test("GET /v1/insights needs the API key", async () => {
  const res = await app.request("/v1/insights");
  assert.equal(res.status, 401);
});

test("an account with nothing to study gets the honest early state, never the example", () =>
  asUser(async () => {
    // The memory store gives a new account one example day: far too little to learn from.
    const body = await get();
    assert.deepEqual(body.insights, []);
    assert.ok(body.studied.days < body.studied.needed_days, `${body.studied.days} days`);
    assert.ok(body.studied.nights <= 1);
    assert.equal(body.studied.needed_days, 14);
    assert.notEqual(body.studied.data_points, mockInsights.studied.data_points);
    for (const s of body.series) {
      assert.ok(s.points.filter((p) => p.value !== null).length <= 3, s.key);
    }
    assert.match(insightsText(body), /Nothing has become a pattern yet/);
  }));

test("GET /v1/insights finds the chain in the user's own events, and keeps the study", () =>
  asUser(async () => {
    await seedMonth();
    const body = await get();
    const chain = body.insights[0];
    assert.equal(chain?.kind, "chain");
    assert.match(chain?.id ?? "", /^chain:late_phone_min>sleep_/);
    assert.equal(chain?.fix.applied_at, null);
    assert.equal(body.studied.nights, 30);
    // A second read is the kept study: the same answer, without reading the events again.
    const again = await get();
    assert.equal(again.generated_at, body.generated_at);
    const text = insightsText(body);
    assert.match(text, /Patterns \(\d+\), strongest first/);
    assert.ok(text.includes(chain?.line ?? "?"));
  }));

test("another user never sees them", () =>
  asUser(async () => {
    await seedMonth();
    assert.ok((await get()).insights.length > 0);
    await runAsUser(randomUUID(), async () => assert.deepEqual((await get()).insights, []));
  }));

test("the one tap fix: a URL encoded id, applied as a standing instruction, and undone", () =>
  asUser(async () => {
    await seedMonth();
    const chain = (await get()).insights[0];
    assert.equal(chain?.fix.action?.kind, "instruction");
    const path = `/insights/${encodeURIComponent(chain?.id ?? "")}/fix`;
    assert.match(path, /chain%3Alate_phone_min%3Esleep_/);

    const before = (await store.listInstructions()).length;
    const applied = Insight.parse(await (await v1Routes.request(path, { method: "POST" })).json());
    assert.equal(applied.id, chain?.id);
    assert.ok(applied.fix.applied_at);
    const rules = await store.listInstructions();
    assert.equal(rules.length, before + 1);
    const rule = rules.find((r) => r.text === chain?.fix.action?.label);
    assert.equal(rule?.kind, "quiet_hours");
    assert.match(rule?.time ?? "", /^\d\d:\d\d$/);
    assert.match(rule?.end_time ?? "", /^\d\d:\d\d$/);
    assert.equal((await get()).insights[0]?.fix.applied_at, applied.fix.applied_at);

    // Twice changes nothing.
    assert.equal((await v1Routes.request(path, { method: "POST" })).status, 200);
    assert.equal((await store.listInstructions()).length, before + 1);

    const undone = Insight.parse(await (await v1Routes.request(path, { method: "DELETE" })).json());
    assert.equal(undone.fix.applied_at, null);
    assert.equal((await store.listInstructions()).length, before);
  }));

test("the fix: unknown id is 404, an insight without a one tap action is 409", async () => {
  const res = await app.request("/v1/insights/link%3Anope%3Enope/fix", { method: "POST", headers: auth });
  assert.equal(res.status, 404);
  await asUser(async () => {
    await seedMonth();
    const plain = (await get()).insights.find((i) => !i.fix.action);
    if (!plain) return;
    const res = await app.request(`/v1/insights/${encodeURIComponent(plain.id)}/fix`, {
      method: "POST",
      headers: auth,
    });
    // The API key is the demo account, which has no such insight: the route itself is checked below.
    assert.equal(res.status, 404);
    // v1Routes alone has no error handler (app maps HttpError to a status), so check the error.
    await assert.rejects(applyFix(plain.id), (e) => e instanceof HttpError && e.code === "conflict");
  });
});

test("a demo visitor may read the insights and may not apply a fix", async () => {
  const visitor = { ...auth, "x-michael-demo-visitor": randomUUID() };
  assert.equal((await app.request("/v1/insights", { headers: visitor })).status, 200);
  for (const method of ["POST", "DELETE"]) {
    const res = await app.request("/v1/insights/chain%3Aa%3Eb%3Ec/fix", { method, headers: visitor });
    assert.equal(res.status, 403, method);
  }
});

test("the real time nudges cite the kept study, and never start one", () =>
  asUser(async () => {
    await seedMonth();
    // Nothing kept yet: nothing to cite, and asking does not study.
    assert.equal(learntAbout("late_phone"), null);
    assert.equal(topInsightFor("late_phone_min"), null);
    const body = await get();
    const learnt = learntAbout("late_phone");
    assert.match(learnt?.reason ?? "", /^Held \d+ of \d+ times\.$/);
    assert.ok((learnt?.line ?? "").split(" ").length <= 6, learnt?.line ?? "no line");
    assert.match(learnt?.line ?? "", /\d/);
    assert.deepEqual(voiceProblems(`${learnt?.line} ${learnt?.reason}`), []);
    assert.equal(topInsightFor("late_phone_min")?.id, body.insights[0]?.id);
  }));
