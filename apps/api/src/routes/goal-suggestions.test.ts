import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Goal, GoalSuggestionsResponse } from "@michael/shared";

// env.ts reads process.env on import, so configure Google before loading the app.
process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret-xyz";
process.env.PUBLIC_API_URL = "https://api.example.test";
process.env.WEB_ORIGIN = "https://web.example.test";

const { app } = await import("../app");
const { runAsUser } = await import("../context");
const { setGoogleFetch } = await import("../integrations/google");
const { signState } = await import("../integrations/state");
const { fakeGoogle, gEvent } = await import("../integrations/fake-google");
const { acceptSuggestion, currentSuggestions } = await import("../goals/suggestions");
const { store } = await import("../store");

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const DAY = 24 * 3600_000;

test("connecting Google Calendar reads four weeks back and says how many goals it sees", async () => {
  const user = randomUUID();
  const now = Date.now();
  // Yoga on three days a week for three weeks back, plus a one-off and a meeting. The memory store
  // starts every user with the mock goals, which already count Gym, Run, Swim and Deep work.
  const yoga = [3, 5, 7, 10, 12, 14, 17, 19, 21].map((d) =>
    gEvent(`yoga${d}`, now - d * DAY, 90, { summary: "Yoga", recurringEventId: "yoga" }),
  );
  const g = fakeGoogle([
    ...yoga,
    gEvent("dentist", now - 9 * DAY, 60, { summary: "Dentist" }),
    gEvent("meet", now - 2 * DAY, 30, {
      summary: "Deep work review",
      attendees: [{ email: "me@example.com", self: true }, { email: "other@example.com" }],
    }),
  ]);
  setGoogleFetch(g.fetch);

  const cb = await app.request(
    `/oauth/google/callback?state=${encodeURIComponent(signState(user, "google_calendar"))}&code=c`,
  );
  assert.equal(cb.status, 302);
  assert.equal(
    cb.headers.get("location"),
    "https://web.example.test/you?connected=google_calendar&goal_suggestions=1",
  );
  const list = g.calls.find((c) => c.url.includes("/events"))?.url ?? "";
  const timeMin = Date.parse(new URL(list).searchParams.get("timeMin") ?? "");
  assert.ok(now - timeMin >= 27 * DAY, "the first sync reads four weeks back");

  await runAsUser(user, async () => {
    const { suggestions } = await currentSuggestions();
    assert.deepEqual(
      suggestions.map((s) => [s.id, s.title, s.weekly_budget_minutes, s.target.calendar_titles]),
      [["training", "Training", 270, ["Yoga"]]],
    );
    // Accepting with an edit creates the goal; then the calendar has nothing left to suggest.
    const goal = Goal.parse(await acceptSuggestion("training", { weekly_budget_minutes: 300 }));
    assert.equal(goal.title, "Training");
    assert.equal(goal.weekly_budget_minutes, 300);
    assert.deepEqual(goal.target?.calendar_titles, ["Yoga"]);
    assert.equal((await currentSuggestions()).suggestions.length, 0);
    assert.equal(await acceptSuggestion("training"), null);
    assert.equal((await store.listGoals()).filter((x) => x.title === "Training").length, 1);
  });
});

test("GET /v1/goals/suggestions answers in the contract, accept of an unknown id is 404", async () => {
  assert.equal((await app.request("/v1/goals/suggestions")).status, 401);
  const res = await app.request("/v1/goals/suggestions", { headers: auth });
  assert.equal(res.status, 200);
  GoalSuggestionsResponse.parse(await res.json());

  const missing = await app.request("/v1/goals/suggestions/nothing-here/accept", {
    method: "POST",
    headers: auth,
  });
  assert.equal(missing.status, 404);
  const bad = await app.request("/v1/goals/suggestions/training/accept", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ weekly_budget_minutes: -5 }),
  });
  assert.equal(bad.status, 400);
});
