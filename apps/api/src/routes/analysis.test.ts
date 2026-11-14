import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AnalysisResult, ApiError } from "@michael/shared";
import { FakeModelClient, ModelError, useModelClient } from "../analysis/model";
import { app } from "../app";
import { env } from "../env";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const post = (body?: unknown, headers: Record<string, string> = auth) =>
  app.request("/v1/analysis/run", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const answer = JSON.stringify({
  summary: "We got 60 of 60 minutes. The gym hour held.",
  recommendations: [
    {
      goal_id: "10000000-0000-4000-8000-000000000002",
      title: "Instagram took 5 minutes at 11:31.",
      rationale: "It opened from a notification. Tomorrow it stays closed until 12:00.",
      action: null,
      evidence: ["time_by_app"],
    },
  ],
  question: null,
});

afterEach(() => useModelClient(null));

test("POST /v1/analysis/run needs the API key", async () => {
  const res = await post({}, { "content-type": "application/json" });
  assert.equal(res.status, 401);
});

test("POST /v1/analysis/run says so when no model key is configured", async () => {
  const key = env.ANTHROPIC_API_KEY;
  env.ANTHROPIC_API_KEY = undefined;
  try {
    const res = await post({});
    assert.equal(res.status, 503);
    const body = ApiError.parse(await res.json());
    assert.equal(body.error.code, "unavailable");
    assert.match(body.error.message, /ANTHROPIC_API_KEY is not set/);
  } finally {
    env.ANTHROPIC_API_KEY = key;
  }
});

test("POST /v1/analysis/run stores the run and returns it with its recommendations", async () => {
  const model = new FakeModelClient([answer]);
  useModelClient(model);
  const range = { from: "2026-11-14T00:00:00+02:00", to: "2026-11-14T20:00:00+02:00", trigger: "evening" };
  const res = await post(range);
  assert.equal(res.status, 201);
  const body = AnalysisResult.parse(await res.json());
  assert.equal(body.run.status, "succeeded");
  assert.equal(body.run.trigger, "evening");
  assert.equal(body.run.range_start, range.from);
  assert.equal(body.run.range_end, range.to);
  assert.equal(body.run.summary, "We got 60 of 60 minutes. The gym hour held.");
  assert.equal(body.recommendations.length, 1);
  assert.equal(body.recommendations[0]?.goal_id, "10000000-0000-4000-8000-000000000002");
  assert.equal(body.recommendations[0]?.status, "proposed");
  assert.equal(model.requests.length, 1);

  // The same run is what the app reads next.
  const latest = AnalysisResult.parse(
    await (await app.request("/v1/analysis/latest", { headers: auth })).json(),
  );
  assert.equal(latest.run.id, body.run.id);
  assert.deepEqual(latest.recommendations, body.recommendations);
  const proposed = (await (
    await app.request("/v1/recommendations?status=proposed", { headers: auth })
  ).json()) as { recommendations: { id: string }[] };
  assert.ok(proposed.recommendations.some((r) => r.id === body.recommendations[0]?.id));
});

test("POST /v1/analysis/run hands the brief the active standing instructions, never a paused one", async () => {
  const add = async (body: unknown) => {
    const res = await app.request("/v1/instructions", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 201);
    return ((await res.json()) as { id: string }).id;
  };
  const active = await add({ text: "Home every day by 21:00", kind: "home_by", time: "21:00" });
  const paused = await add({ text: "No calls on Friday afternoons", kind: "custom", active: false });
  try {
    const model = new FakeModelClient([answer]);
    useModelClient(model);
    assert.equal((await post({})).status, 201);
    const brief = model.requests[0]?.user ?? "";
    // The mock rule and the new one, in the person's own words, oldest first, with the mock's
    // exception in words.
    assert.match(
      brief,
      /"instructions": \[\s*"Keep Sundays clear \(except: Rhefuel\)",\s*"Home every day by 21:00"\s*\]/,
    );
    assert.ok(!brief.includes("No calls on Friday afternoons"), "a paused instruction reached the brief");

    // Pausing takes an instruction out of the next run.
    await app.request(`/v1/instructions/${active}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ active: false }),
    });
    const next = new FakeModelClient([answer]);
    useModelClient(next);
    assert.equal((await post({})).status, 201);
    assert.match(
      next.requests[0]?.user ?? "",
      /"instructions": \[\s*"Keep Sundays clear \(except: Rhefuel\)"\s*\]/,
    );
  } finally {
    for (const id of [active, paused]) {
      await app.request(`/v1/instructions/${id}`, { method: "DELETE", headers: auth });
    }
  }
});

test("POST /v1/analysis/run works with no body at all", async () => {
  useModelClient(new FakeModelClient([answer]));
  const res = await app.request("/v1/analysis/run", {
    method: "POST",
    headers: { Authorization: auth.Authorization },
  });
  assert.equal(res.status, 201);
  const body = AnalysisResult.parse(await res.json());
  assert.equal(body.run.trigger, "manual");
});

test("POST /v1/analysis/run answers 502 when the model fails, and keeps the failed run", async () => {
  useModelClient(
    new FakeModelClient([new ModelError("refusal", "the model declined to answer (no category)")]),
  );
  const res = await post({});
  assert.equal(res.status, 502);
  const body = ApiError.parse(await res.json());
  assert.equal(body.error.code, "upstream_error");
  const latest = AnalysisResult.parse(
    await (await app.request("/v1/analysis/latest", { headers: auth })).json(),
  );
  assert.equal(latest.run.status, "failed");
  assert.equal(latest.run.id, (body.error.details as { run_id: string }).run_id);
  assert.deepEqual(latest.recommendations, []);

  useModelClient(new FakeModelClient(["this is not json"]));
  assert.equal((await post({})).status, 502);
});

test("POST /v1/analysis/run rejects a bad body before calling the model", async () => {
  const model = new FakeModelClient([answer]);
  useModelClient(model);
  for (const bad of [
    "{not json",
    { from: "yesterday" },
    { trigger: "lunchtime" },
    { from: "2026-11-14T12:00:00+02:00", to: "2026-11-14T09:00:00+02:00" },
    { from: "2026-01-01T00:00:00+02:00", to: "2026-11-14T09:00:00+02:00" },
  ]) {
    const res = await post(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(ApiError.parse(await res.json()).error.code, "bad_request");
  }
  assert.equal(model.requests.length, 0);
});

test("POST /v1/analysis/run?mode=specialists runs the specialists, and an unknown mode is a 400", async () => {
  // Every specialist finds nothing; the coordinator answers as the single pass would.
  const specialists = new FakeModelClient([JSON.stringify({ findings: [] })]);
  const coordinator = new FakeModelClient([answer]);
  useModelClient({
    model: "fake-model",
    complete: (request) =>
      "findings" in ((request.schema.properties ?? {}) as object)
        ? specialists.complete(request)
        : coordinator.complete(request),
  });
  const run = (mode: string) =>
    app.request(`/v1/analysis/run?mode=${mode}`, { method: "POST", headers: auth, body: "{}" });
  const res = await run("specialists");
  assert.equal(res.status, 201);
  const body = AnalysisResult.parse(await res.json());
  assert.equal(body.run.status, "succeeded");
  assert.ok(specialists.requests.length >= 1, "at least one specialist was asked");
  assert.ok(specialists.requests.every((r) => r.effort === "low"));
  assert.match(coordinator.requests[0]?.system ?? "", /Working with specialists/);
  // Its recommendation named no finding, so it has no specialist.
  assert.equal(body.recommendations[0]?.specialist ?? null, null);

  assert.equal((await run("committee")).status, 400);
});
