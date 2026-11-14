import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Goal,
  GoalCategory,
  GoalCreate,
  GoalTarget,
  GoalUpdate,
  goalArea,
  goalKind,
  isSleepGoal,
} from "@michael/shared";
import { app } from "../app";
import { goal } from "../patterns/testkit";

// The three goal categories, what a goal measures, and the soft check on `goal.target`.

const ID = "10000000-0000-4000-8000-000000000001";
const withTarget = (category: Goal["category"], title: string, target: Record<string, unknown> | null) => ({
  ...goal(category, ID, title),
  target,
});

test("goalArea: three categories, and the four older values still read", () => {
  assert.deepEqual(
    GoalCategory.options.map((c) => [c, goalArea(c)]),
    [
      ["business", "business"],
      ["health", "health"],
      ["personal", "personal"],
      ["work", "business"],
      ["gym", "health"],
      ["rest", "health"],
      ["food", "health"],
    ],
  );
});

test("goalKind: time unless target.kind names another kind", () => {
  assert.equal(goalKind(withTarget("business", "The company", null)), "time");
  assert.equal(goalKind(withTarget("business", "The company", {})), "time");
  assert.equal(goalKind(withTarget("business", "The company", { calendar_titles: ["Study"] })), "time");
  assert.equal(goalKind(withTarget("personal", "Fun", { kind: "time", label: "fun" })), "time");
  assert.equal(goalKind(withTarget("health", "Sleep", { kind: "target", sleep_hours: 7.5 })), "target");
  assert.equal(goalKind(withTarget("health", "Yoga", { kind: "count", per_week: 2 })), "count");
  assert.equal(goalKind(withTarget("business", "Today", { kind: "checklist" })), "checklist");
  // A kind that does not exist (the dropped `protected`, a typo, a number) reads as the default.
  assert.equal(goalKind(withTarget("personal", "Sundays", { kind: "protected" })), "time");
  assert.equal(goalKind(withTarget("health", "Run", { kind: 3 })), "time");
});

test("goalKind and isSleepGoal: a sleep goal saved before kinds existed is still a target", () => {
  // The older shape: category `rest`, a sleep key or the word in the title, no kind.
  const old = withTarget("rest", "Sleep", { sleep_hours: 7.5 });
  assert.equal(goalKind(old), "target");
  assert.equal(isSleepGoal(old), true);
  assert.equal(goalKind(withTarget("rest", "Sleep 8 hours", null)), "target");
  assert.equal(goalKind(withTarget("rest", "Evenings off", { evenings: 3 })), "time");
  // The kind decides first: it wins over the older reading in both directions.
  assert.equal(goalKind(withTarget("rest", "Sleep", { kind: "time", bedtime: "23:00" })), "time");
  assert.equal(isSleepGoal(withTarget("rest", "Sleep", { kind: "time", bedtime: "23:00" })), false);
  // The new shape.
  const sleep = withTarget("health", "Sleep", { kind: "target", sleep_hours: 7.5, screens_off: "23:00" });
  assert.equal(isSleepGoal(sleep), true);
  // A health target that is not about sleep, and sleep words outside health, are not sleep goals.
  assert.equal(isSleepGoal(withTarget("health", "Protein", { kind: "target", protein_g: 140 })), false);
  assert.equal(isSleepGoal(withTarget("business", "Sleep research", { sleep_hours: 8 })), false);
  assert.equal(isSleepGoal(withTarget("health", "70.3", { calendar_titles: ["Run"] })), false);
});

test("goal target: known keys are typed, unknown keys are kept", () => {
  const ok = (target: unknown) => GoalTarget.safeParse(target).success;
  // Unknown keys pass through untouched, next to the known ones.
  const parsed = GoalTarget.parse({
    kind: "time",
    label: "fun",
    calendar_titles: ["Night out"],
    work_categories: ["communication"],
    deep_work_hours: 4,
    anything: { nested: [1, 2] },
  });
  assert.deepEqual(parsed, {
    kind: "time",
    label: "fun",
    calendar_titles: ["Night out"],
    work_categories: ["communication"],
    deep_work_hours: 4,
    anything: { nested: [1, 2] },
  });
  assert.equal(ok({}), true);
  assert.equal(ok({ kind: "target", sleep_hours: 7.5, screens_off: "23:00" }), true);
  assert.equal(ok({ kind: "count", per_week: 2 }), true);
  assert.equal(ok({ kind: "checklist" }), true);

  // Known keys with the wrong type are refused.
  assert.equal(ok({ kind: "protected" }), false);
  assert.equal(ok({ label: "" }), false);
  assert.equal(ok({ label: 7 }), false);
  assert.equal(ok({ calendar_titles: "Study" }), false);
  assert.equal(ok({ calendar_titles: ["Study", 5] }), false);
  assert.equal(ok({ work_categories: ["email"] }), false);
  assert.equal(ok({ work_categories: "communication" }), false);
  assert.equal(ok({ sleep_hours: "7.5" }), false);
  assert.equal(ok({ screens_off: "11pm" }), false);
  assert.equal(ok({ screens_off: "24:00" }), false);
  assert.equal(ok({ per_week: 0 }), false);
  assert.equal(ok({ per_week: 2.5 }), false);

  // The same check runs on create and on update; no target at all is fine.
  const base = { category: "personal", title: "Fun" };
  assert.equal(GoalCreate.safeParse(base).success, true);
  assert.equal(GoalCreate.safeParse({ ...base, target: null }).success, true);
  assert.equal(GoalCreate.safeParse({ ...base, target: { label: "fun", mood: "good" } }).success, true);
  assert.equal(GoalCreate.safeParse({ ...base, target: { kind: "protected" } }).success, false);
  assert.equal(GoalUpdate.safeParse({ target: { work_categories: ["messaging"] } }).success, false);
  assert.equal(GoalUpdate.safeParse({ target: { work_categories: ["communication"] } }).success, true);
  // A stored goal is read leniently: whatever sits in `target` still parses as a Goal.
  assert.equal(
    Goal.safeParse(withTarget("business", "Old", { kind: "protected", per_week: "2" })).success,
    true,
  );
});

test("POST and PATCH /v1/goals take any of the seven categories and check the target", async () => {
  const headers = { Authorization: "Bearer dev-key", "content-type": "application/json" };
  const call = (method: string, path: string, body: unknown) =>
    app.request(path, { method, headers, body: JSON.stringify(body) });

  const ids: string[] = [];
  for (const category of GoalCategory.options) {
    const res = await call("POST", "/v1/goals", { category, title: `A ${category} goal` });
    assert.equal(res.status, 201, category);
    const created = Goal.parse(await res.json());
    assert.equal(created.category, category);
    ids.push(created.id);
  }
  assert.equal(
    (await call("POST", "/v1/goals", { category: "family", title: "No such category" })).status,
    400,
  );

  const sales = await call("POST", "/v1/goals", {
    category: "business",
    title: "Sales",
    weekly_budget_minutes: 480,
    target: { calendar_titles: ["Call Leads"], work_categories: ["communication"], quota: 12 },
  });
  assert.equal(sales.status, 201);
  const stored = Goal.parse(await sales.json());
  assert.deepEqual(stored.target, {
    calendar_titles: ["Call Leads"],
    work_categories: ["communication"],
    quota: 12,
  });
  ids.push(stored.id);

  const bad = await call("POST", "/v1/goals", {
    category: "business",
    title: "Sales",
    target: { work_categories: ["phone calls"] },
  });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "bad_request");

  const path = `/v1/goals/${stored.id}`;
  assert.equal((await call("PATCH", path, { target: { kind: "protected" } })).status, 400);
  const patched = await call("PATCH", path, { target: { kind: "count", per_week: 3 } });
  assert.equal(patched.status, 200);
  assert.equal(goalKind(Goal.parse(await patched.json())), "count");

  for (const id of ids) await app.request(`/v1/goals/${id}`, { method: "DELETE", headers });
});
