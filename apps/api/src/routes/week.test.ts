import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { GoalCreate, type Recommendation, WeekReview } from "@michael/shared";
import { Hono } from "hono";
import { runAsUser } from "../context";
import { errorResponse, HttpError } from "../http";
import { Zone } from "../patterns/time";
import { store } from "../store";
import { phraseLesson } from "../week/phrase";
import { computeReview } from "../week/review";

const { app, v1Routes } = await import("../app");
// The /v1 routes as the user of the surrounding runAsUser, with the app's error answers.
const routes = new Hono()
  .route("/", v1Routes)
  .onError((err, c) =>
    err instanceof HttpError
      ? errorResponse(c, err.code, err.message)
      : errorResponse(c, "internal", String(err)),
  );
const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };

test("GET /v1/week/review needs the key and answers the contract", async () => {
  assert.equal((await app.request("/v1/week/review")).status, 401);
  const res = await app.request("/v1/week/review", { headers: auth });
  assert.equal(res.status, 200);
  const r = WeekReview.parse(await res.json());
  assert.equal(r.timezone, "Europe/Athens");
  assert.ok(r.lesson.length > 0);
  assert.equal(r.phrased_by, "template");
  const bad = await app.request("/v1/week/review?week=2026-02-30", { headers: auth });
  assert.equal(bad.status, 400);
});

test("GET /v1/week/review takes any day of a week and writes nothing", async () => {
  await runAsUser(
    randomUUID(),
    async () => {
      const before = (await store.listRecords()).length;
      const res = await routes.request("/week/review?week=2026-11-11&now=2026-11-15T19:00:00%2B02:00", {
        headers: auth,
      });
      assert.equal(res.status, 200);
      const r = WeekReview.parse(await res.json());
      assert.equal(r.week_start, "2026-11-09");
      assert.equal(r.next_week.week_start, "2026-11-16");
      assert.equal((await store.listRecords()).length, before);
    },
    "script",
  );
});

test("POST /v1/week/plan books the goal's first free slot next week, undoable; refuses a bad goal", async () => {
  await runAsUser(
    randomUUID(),
    async () => {
      const goal = await store.createGoal(
        GoalCreate.parse({ category: "business", title: "University", weekly_budget_minutes: 360 }),
      );
      const res = await routes.request("/week/plan", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ goal_id: goal.id, minutes: 60 }),
      });
      assert.equal(res.status, 201);
      const rec = (await res.json()) as Recommendation;
      assert.equal(rec.status, "done");
      assert.equal(rec.action?.kind, "create_focus_block");
      // Next week: on or after next Monday in Athens.
      const zone = new Zone("Europe/Athens");
      const start = Date.parse(String(rec.action?.payload.start_at));
      const today = zone.dayOf(Date.now());
      let monday = zone.nextDay(today);
      while (new Date(`${monday}T12:00:00Z`).getUTCDay() !== 1) monday = zone.nextDay(monday);
      assert.ok(start >= zone.startOfDay(monday), "booked next week");
      assert.equal(rec.action?.undo_until, rec.action?.payload.start_at);

      const missing = await routes.request("/week/plan", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ goal_id: randomUUID(), minutes: 60 }),
      });
      assert.equal(missing.status, 404);
      const short = await routes.request("/week/plan", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ goal_id: goal.id, minutes: 5 }),
      });
      assert.equal(short.status, 400);
    },
    "script",
  );
});

test("the lesson: a model line is used only when every number in it is in the facts", async () => {
  const res = await app.request("/v1/week/review?week=2026-11-11&now=2026-11-15T19:00:00%2B02:00", {
    headers: auth,
  });
  const r = WeekReview.parse(await res.json());
  const core = { ...r, lesson: r.lesson };
  const reply = (text: string) => async () => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
  });
  const made = await phraseLesson(core, "t1", reply("Book the first block before Monday's mail."));
  assert.deepEqual(made, { lesson: "Book the first block before Monday's mail.", phrased_by: "model" });
  const invented = await phraseLesson(core, "t2", reply("You lost 999 minutes. Fix it next week."));
  assert.equal(invented.phrased_by, "template");
  const cut = await phraseLesson(core, "t3", async () => ({
    stop_reason: "max_tokens",
    content: [{ type: "text", text: "Book the first block." }],
  }));
  assert.equal(cut.phrased_by, "template");
  assert.equal(typeof computeReview, "function");
});
