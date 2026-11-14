import assert from "node:assert/strict";
import { test } from "node:test";
import { AnalysisResult, mockEvents } from "@michael/shared";
import { runAsUser } from "../context";
import { HttpError } from "../http";
import { calendar, T } from "../patterns/testkit";
import { MemoryStore, type TimelineFilter } from "../store";
import { COACH_INSTRUCTIONS } from "./coach";
import { FakeModelClient, ModelError } from "./model";
import { loadEvents, runAnalysis } from "./run";

// The whole run against the in-memory store (which starts every user with the mock day,
// Saturday 14 November 2026) and a model that answers from a script. No network.

const NOW = "2026-11-14T20:00:00+02:00";
const clock = () => new Date(NOW);

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    summary: "We got 60 of 60 minutes. The gym hour held.",
    recommendations: [
      {
        goal_id: null,
        title: "Instagram took 5 minutes at 11:31.",
        rationale: "It opened from a notification. Tomorrow it stays closed until 12:00.",
        action: null,
        evidence: ["time_by_app"],
      },
    ],
    question: null,
    ...over,
  });

/** One user, one fresh store, one scripted model. */
async function run(
  script: (string | Error)[],
  request: Parameters<typeof runAnalysis>[0] = { trigger: "evening" },
) {
  const store = new MemoryStore();
  const model = new FakeModelClient(script);
  const logs: Record<string, unknown>[] = [];
  const user = crypto.randomUUID();
  const inUser = <T>(fn: () => Promise<T>) => runAsUser(user, fn);
  const result = await inUser(() =>
    runAnalysis(request, { store, model, now: clock, log: (entry) => logs.push(entry) }).then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    ),
  );
  const latest = await inUser(() => store.latestAnalysisRun());
  const stored = await inUser(() => store.listRecommendations());
  return { ...result, model, logs, latest, stored };
}

test("a good answer is stored as a succeeded run with its recommendations", async () => {
  const { value, error, model, latest, stored, logs } = await run([
    reply({ question: "Was the 18:00 hour training?" }),
  ]);
  assert.equal(error, null);
  const result = AnalysisResult.parse(value);
  assert.equal(result.run.status, "succeeded");
  assert.equal(result.run.trigger, "evening");
  assert.equal(result.run.model, "fake-model");
  assert.equal(result.run.summary, "We got 60 of 60 minutes. The gym hour held.");
  assert.equal(result.run.question, "Was the 18:00 hour training?");
  assert.equal(result.run.error, null);
  assert.equal(result.run.range_start, new Date(T("2026-11-14 00:00")).toISOString());
  assert.equal(result.run.range_end, new Date(NOW).toISOString());
  assert.equal(result.recommendations.length, 1);
  const rec = result.recommendations[0];
  assert.equal(rec?.analysis_run_id, result.run.id);
  assert.equal(rec?.status, "proposed");
  assert.deepEqual(rec?.evidence, ["time_by_app"]);
  // Stored for this user: the latest run and a row among the recommendations.
  assert.equal(latest?.id, result.run.id);
  assert.ok(stored.some((r) => r.id === rec?.id));
  assert.equal(model.requests.length, 1, "one call when nothing is wrong");
  assert.deepEqual(
    logs.map((l) => l.event),
    ["analysis_model_call"],
  );
});

test("the model gets the coach instructions and a brief, never raw events", async () => {
  const { model } = await run([reply()]);
  const request = model.requests[0];
  assert.equal(request?.system, COACH_INSTRUCTIONS);
  assert.match(request?.user ?? "", /"trigger": "evening"/);
  assert.match(request?.user ?? "", /"now": "2026-11-14 20:00"/);
  // The store starts every user with one standing instruction, and it reaches the brief as written,
  // with its exception in words.
  assert.match(request?.user ?? "", /"instructions": \[\s*"Keep Sundays clear \(except: Rhefuel\)"\s*\]/);
  // The mock day holds a search, a page title, a conversation and a call with other people.
  for (const leak of [
    "athens new york flights december",
    "Flights from Athens to New York",
    "Planned Michael architecture",
    "Hackathon kickoff call",
    "skyscanner",
  ]) {
    assert.ok(!request?.user.includes(leak), `"${leak}" reached the model`);
  }
  for (const e of mockEvents) assert.ok(!request?.user.includes(e.id), "an event id reached the model");
  assert.equal(request?.schema.type, "object");
});

test("a refusal is stored as a failed run and answered with 502", async () => {
  const { error, latest, stored, logs } = await run([
    new ModelError("refusal", "the model declined to answer (cyber)"),
  ]);
  assert.ok(error instanceof HttpError);
  assert.equal(error.code, "upstream_error");
  assert.match(error.message, /declined/);
  assert.equal(latest?.status, "failed");
  assert.equal(latest?.summary, null);
  assert.match(latest?.error ?? "", /declined/);
  assert.equal(latest?.model, "fake-model");
  assert.ok(latest?.finished_at);
  assert.deepEqual((error.details as { run_id: string }).run_id, latest?.id);
  assert.ok(
    stored.every((r) => r.analysis_run_id !== latest?.id),
    "a failed run has no recommendations",
  );
  assert.equal(logs.at(-1)?.event, "analysis_failed");
});

test("an answer that is not the agreed JSON fails the run too", async () => {
  for (const bad of ["I cannot help with that.", JSON.stringify({ summary: "No recommendations key." })]) {
    const { error, latest, model } = await run([bad]);
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "upstream_error");
    assert.equal(latest?.status, "failed");
    assert.equal(model.requests.length, 1, "a broken answer is not retried");
  }
});

test("an API failure fails the run, and other errors are not swallowed", async () => {
  const api = await run([new ModelError("api", "the model API timed out")]);
  assert.ok(api.error instanceof HttpError);
  assert.equal(api.latest?.status, "failed");
  const bug = await run([new TypeError("a bug, not the model")]);
  assert.ok(bug.error instanceof TypeError);
});

test("a copy violation gets one retry that names the rule, and the clean answer is stored", async () => {
  const first = reply({ summary: "We got 60 of 60 minutes — the gym hour held!" });
  const { value, model, logs } = await run([first, reply()]);
  assert.equal(model.requests.length, 2);
  const retry = model.requests[1]?.user ?? "";
  assert.ok(retry.startsWith(model.requests[0]?.user ?? "?"), "the brief comes first, unchanged");
  assert.match(retry, /summary breaks a copy rule: no dashes as punctuation/);
  assert.match(retry, /summary breaks a copy rule: no exclamation marks/);
  assert.ok(retry.includes(first), "the first answer is shown back");
  assert.equal(
    model.requests[1]?.system,
    COACH_INSTRUCTIONS,
    "the cached instructions are sent again as they are",
  );
  assert.equal(value?.run.status, "succeeded");
  assert.equal(value?.run.summary, "We got 60 of 60 minutes. The gym hour held.");
  assert.ok(!logs.some((l) => l.event === "analysis_answer_corrected"));
});

test("if the retry still breaks a rule the run is stored anyway and the violations are logged", async () => {
  const bad = reply({ summary: "Amazing day!" });
  const { value, error, model, logs } = await run([bad, bad]);
  assert.equal(error, null);
  assert.equal(model.requests.length, 2, "one retry, never two");
  assert.equal(value?.run.status, "succeeded");
  assert.equal(value?.run.summary, "Amazing day!");
  const logged = logs.find((l) => l.event === "analysis_answer_corrected");
  assert.equal(logged?.run_id, value?.run.id);
  assert.deepEqual(
    ((logged?.copy_violations ?? []) as { where: string; rule: string }[]).map((v) => v.rule),
    ["no exclamation marks", 'never use the word "amazing"'],
  );
});

test("a line that says an action is already done gets the retry: actions are offers", async () => {
  const claims = reply({ summary: "We got 60 of 60 minutes. I've set a reminder for 20:30." });
  const offers = reply({ summary: "We got 60 of 60 minutes. I can set a reminder for 20:30. One tap." });
  const { value, model } = await run([claims, offers]);
  assert.match(model.requests[0]?.user ?? "", /"actions_are": "offers"/);
  assert.equal(model.requests.length, 2);
  assert.match(
    model.requests[1]?.user ?? "",
    /summary breaks a copy rule: actions are offers: nothing has happened yet/,
  );
  assert.equal(value?.run.summary, "We got 60 of 60 minutes. I can set a reminder for 20:30. One tap.");
});

test("a question that was asked is in the next run's brief, so it is not asked again", async () => {
  const store = new MemoryStore();
  const model = new FakeModelClient([reply({ question: "Was the 18:00 hour training or rest?" }), reply()]);
  const user = crypto.randomUUID();
  const once = () =>
    runAsUser(user, () => runAnalysis({ trigger: "evening" }, { store, model, now: clock, log: () => {} }));
  await once();
  await once();
  assert.match(model.requests[0]?.user ?? "", /"already_asked": \[\]/);
  assert.match(
    model.requests[1]?.user ?? "",
    /"already_asked": \[\s+\{\s+"asked": "2026-11-14",\s+"question": "Was the 18:00 hour training or rest\?"/,
  );
});

test("if the retry itself fails, the first answer stands", async () => {
  const first = reply({ summary: "A solid day!" });
  for (const second of [new ModelError("api", "the model API timed out"), "not json"]) {
    const { value, error, logs } = await run([first, second]);
    assert.equal(error, null);
    assert.equal(value?.run.summary, "A solid day!");
    assert.ok(logs.some((l) => l.event === "analysis_retry_failed"));
  }
});

test("an action on something that is not the person's is dropped, and the retry says so", async () => {
  const rec = {
    goal_id: null,
    title: "The kickoff call ran 30 minutes.",
    rationale: "I moved it to 16:00. Undo until 16:00.",
    action: {
      kind: "move_calendar_block",
      block: "b9",
      day: "2026-11-15",
      start: "16:00",
      end: null,
      app: null,
      text: null,
    },
    evidence: [],
  };
  const { value, model, logs } = await run([
    reply({ recommendations: [rec] }),
    reply({ recommendations: [rec] }),
  ]);
  assert.match(
    model.requests[1]?.user ?? "",
    /recommendations\[0\]\.action was not allowed: it does not name one of the person's own blocks/,
  );
  assert.equal(value?.recommendations.length, 1, "the recommendation stays");
  assert.equal(value?.recommendations[0]?.action, null, "the action does not");
  const logged = logs.find((l) => l.event === "analysis_answer_corrected");
  assert.equal(((logged?.corrections ?? []) as { kind: string }[])[0]?.kind, "action_dropped");
});

test("the range defaults to today so far and a past range is read as it stood then", async () => {
  const today = await run([reply()], {});
  assert.equal(today.value?.run.trigger, "manual");
  assert.match(
    today.model.requests[0]?.user ?? "",
    /"from": "2026-11-14 00:00",\n\s+"to": "2026-11-14 20:00"/,
  );

  const past = await run([reply()], {
    from: T("2026-11-12 00:00"),
    to: T("2026-11-13 00:00"),
    trigger: "evening",
  });
  assert.equal(past.value?.run.range_end, T("2026-11-13 00:00"));
  assert.match(past.model.requests[0]?.user ?? "", /"now": "2026-11-12 24:00"/);
  assert.match(past.model.requests[0]?.user ?? "", /"weekday": "Thursday"/);
});

test("a bad range is a 400 and no run is stored for it", async () => {
  const { error, model, latest } = await run([reply()], {
    from: T("2026-11-14 12:00"),
    to: T("2026-11-14 09:00"),
  });
  assert.ok(error instanceof HttpError);
  assert.equal(error.code, "bad_request");
  assert.equal(model.requests.length, 0);
  assert.notEqual(latest?.status, "failed");
});

test("loadEvents reads the window a week at a time and keeps each event once", async () => {
  const crossing = calendar("Night shift", T("2026-11-07 23:00"), T("2026-11-08 01:00"));
  const later = calendar("Study", T("2026-11-12 10:00"), T("2026-11-12 11:00"));
  const calls: TimelineFilter[] = [];
  const store = {
    async listEvents(filter: TimelineFilter) {
      calls.push(filter);
      return [crossing, later].filter(
        (e) =>
          Date.parse(e.start_at) <= Date.parse(filter.to) &&
          Date.parse(e.end_at ?? e.start_at) >= Date.parse(filter.from),
      );
    },
  };
  const events = await loadEvents(store, T("2026-11-01 00:00"), T("2026-11-15 00:00"));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.type?.includes("calendar_event") && !c.type.includes("conversation")));
  assert.deepEqual(
    events.map((e) => e.title),
    ["Night shift", "Study"],
  );
});
