import assert from "node:assert/strict";
import { test } from "node:test";
import { InsightsResponse, mockInsights, voiceProblems } from "@michael/shared";
import { app } from "../app";

const auth = { Authorization: "Bearer dev-key" };

test("GET /v1/insights needs the API key", async () => {
  const res = await app.request("/v1/insights");
  assert.equal(res.status, 401);
});

test("GET /v1/insights answers the contract", async () => {
  const res = await app.request("/v1/insights", { headers: auth });
  assert.equal(res.status, 200);
  const body = InsightsResponse.parse(await res.json());
  assert.ok(body.insights.length > 0);
});

test("the example insights keep the contract's promises", () => {
  const body = InsightsResponse.parse(mockInsights);
  const rank = (i: (typeof body.insights)[number]) => (i.status === "pattern" ? 0 : 1);
  for (const [n, insight] of body.insights.entries()) {
    // Patterns before watching, strongest first.
    const prev = body.insights[n - 1];
    if (prev) {
      assert.ok(rank(prev) <= rank(insight), insight.id);
      if (rank(prev) === rank(insight)) assert.ok(prev.strength >= insight.strength, insight.id);
    }
    assert.equal(insight.steps.length, insight.kind === "chain" ? 3 : 2, insight.id);
    assert.equal(insight.evidence.history.length, insight.evidence.days.length, insight.id);
    assert.equal(insight.evidence.history.length, Math.min(30, insight.evidence.times_seen), insight.id);
    assert.equal(insight.evidence.history.filter(Boolean).length, insight.evidence.times_held, insight.id);
    assert.equal(insight.last_seen, insight.evidence.days.at(-1), insight.id);
    for (const line of [insight.title, insight.line, insight.fix.text]) {
      assert.deepEqual(voiceProblems(line), [], line);
    }
    for (const step of insight.steps) {
      if (step.usual_num !== undefined) assert.match(step.value, / against /, step.value);
    }
  }
  assert.equal(new Set(body.insights.map((i) => i.id)).size, body.insights.length);
  for (const s of body.series) assert.equal(s.points.length, body.studied.days, s.key);
});
