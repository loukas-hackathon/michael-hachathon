import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type Event, type Goal, GoalCreate, type Instruction } from "@michael/shared";
import { runAsUser } from "../context";
import { HttpError } from "../http";
import { Zone } from "../patterns/time";
import { scoreFor } from "../routes/score";
import { store } from "../store";
import { bookGoalTime, goalBooking, goalSlot, noSlotLine } from "./book";

const { app } = await import("../app");

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const block = (start: string, end: string) =>
  ({ type: "calendar_event", start_at: start, end_at: end, data: {}, title: "Busy" }) as unknown as Event;
const base = { title: "Study", goals: [], instructions: [] };

test("goalSlot: the first free slot from now, on the quarter hour, clear of the calendar", () => {
  // Wednesday 11 November, 10:02 in Athens (UTC+2); busy 10:15 to 12:00.
  const slot = goalSlot({
    ...base,
    now: Date.parse("2026-11-11T08:02:00Z"),
    minutes: 60,
    events: [block("2026-11-11T08:15:00Z", "2026-11-11T10:00:00Z")],
  });
  assert.equal(slot && new Date(slot.start).toISOString(), "2026-11-11T10:00:00.000Z");
  assert.equal(slot && new Date(slot.end).toISOString(), "2026-11-11T11:00:00.000Z");
});

test("goalSlot: never sooner than five minutes from now", () => {
  const slot = goalSlot({ ...base, now: Date.parse("2026-11-11T08:14:00Z"), minutes: 30, events: [] });
  assert.equal(slot && new Date(slot.start).toISOString(), "2026-11-11T08:30:00.000Z");
});

test("goalSlot: null when the week has no room left", () => {
  // Sunday 22:30 in Athens: six hours do not fit before the week ends.
  const slot = goalSlot({ ...base, now: Date.parse("2026-11-15T20:30:00Z"), minutes: 360, events: [] });
  assert.equal(slot, null);
});

test("POST /v1/goals/:id/book checks the length and the goal", async () => {
  const short = await app.request("/v1/goals/10000000-0000-4000-8000-000000000005/book", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ minutes: 5 }),
  });
  assert.equal(short.status, 400);
  const missing = await app.request("/v1/goals/00000000-0000-4000-8000-00000000dead/book", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ minutes: 60 }),
  });
  assert.equal(missing.status, 404);
  assert.equal((await app.request("/v1/goals/x/book", { method: "POST" })).status, 401);
});

// ---------- why nothing fits, and the shorter block instead (#330) ----------

const rule = (i: Partial<Instruction> & Pick<Instruction, "kind" | "text">): Instruction => ({
  id: randomUUID(),
  active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  ...i,
});
const SUNDAYS = rule({ text: "Keep Sundays clear", kind: "clear_day", days: [0] });
// A sleep goal of 7.5 hours with screens off at 23:00: the waking day starts at 06:30.
const SLEEP_0630 = GoalCreate.parse({
  category: "health",
  title: "Sleep",
  target: { kind: "target", sleep_hours: 7.5, screens_off: "23:00" },
}) as unknown as Goal;
const iso = (ms: number) => new Date(ms).toISOString();

test("goalBooking: the longest shorter slot when the length asked for no longer fits", () => {
  // Sunday 22:10 in Athens: the waking day ends at 23:00, so 45 minutes from 22:15 is what is left.
  const late = { ...base, now: Date.parse("2026-11-15T20:10:00Z"), events: [] };
  const found = goalBooking({ ...late, minutes: 90 });
  assert.ok(found.slot);
  assert.equal(found.minutes, 45);
  assert.deepEqual(
    [iso(found.slot.start), iso(found.slot.end)],
    ["2026-11-15T20:15:00.000Z", "2026-11-15T21:00:00.000Z"],
  );
  // The length asked for wins while it fits; under half an hour nothing is booked instead.
  assert.equal((goalBooking({ ...late, minutes: 45 }) as { minutes: number }).minutes, 45);
  assert.deepEqual(goalBooking({ ...late, now: Date.parse("2026-11-15T20:35:00Z"), minutes: 90 }), {
    slot: null,
    kept: null,
  });
});

test("goalBooking and noSlotLine: a standing instruction that keeps the rest is named as the reason", () => {
  // Sunday 02:19 in Athens with Sundays kept clear: the review's case.
  const sunday = { ...base, now: Date.parse("2026-11-15T00:19:00Z"), events: [], minutes: 90 };
  const clear = goalBooking({ ...sunday, instructions: [SUNDAYS] });
  assert.deepEqual(clear, { slot: null, kept: SUNDAYS });
  assert.equal(noSlotLine(90, SUNDAYS), "Sundays are kept clear, so no 90 minutes are left this week.");
  // A block the rule's exceptions name may still go there.
  assert.ok(goalBooking({ ...sunday, instructions: [{ ...SUNDAYS, exceptions: ["Study"] }] }).slot);
  // A paused rule keeps nothing.
  assert.ok(goalBooking({ ...sunday, instructions: [{ ...SUNDAYS, active: false }] }).slot);

  // The rule that keeps the most of the open time is the reason, not the first one in the list:
  // quiet hours until 07:00 hold one slot of a clear Sunday, the clear day holds all of them.
  const quiet = rule({ text: "Nothing before 07:00", kind: "quiet_hours", time: "23:00", end_time: "07:00" });
  const early = { ...sunday, now: Date.parse("2026-11-15T04:31:00Z"), goals: [SLEEP_0630] };
  assert.deepEqual(goalBooking({ ...early, instructions: [quiet, SUNDAYS] }), { slot: null, kept: SUNDAYS });
  // Saturday 21:30 with "home by 21:00" and a clear Sunday: Sunday is most of what is left.
  const home = rule({ text: "Home by 21:00", kind: "home_by", time: "21:00" });
  const saturday = { ...sunday, now: Date.parse("2026-11-14T19:30:00Z") };
  assert.deepEqual(goalBooking({ ...saturday, instructions: [home, SUNDAYS] }), {
    slot: null,
    kept: SUNDAYS,
  });
  // Sunday 21:10 with only "home by 21:00": that rule holds the evening.
  const evening = { ...sunday, now: Date.parse("2026-11-15T19:10:00Z") };
  assert.deepEqual(goalBooking({ ...evening, instructions: [home] }), { slot: null, kept: home });
  assert.equal(noSlotLine(90, home), "You're home by 21:00, so no 90 minutes are left this week.");
  assert.equal(noSlotLine(120, quiet), "Your quiet hours cover the rest, so no 2h are left this week.");
  // No rule in the way: the week is simply full.
  assert.equal(noSlotLine(90, null), "No free 90 minutes left this week.");
  assert.deepEqual(
    goalBooking({ ...sunday, now: Date.parse("2026-11-15T20:50:00Z"), instructions: [SUNDAYS] }),
    {
      slot: null,
      kept: null,
    },
  );
});

test("Book and the score's free minutes agree on a clear Sunday; a shorter block says so", async () => {
  // The Sunday after next, so every slot is ahead of the real clock.
  const zone = new Zone("Europe/Athens");
  let day = zone.nextDay(zone.dayOf(Date.now()), 7);
  while (new Date(`${day}T00:00:00Z`).getUTCDay() !== 0) day = zone.nextDay(day);
  await runAsUser(
    randomUUID(),
    async () => {
      const goal = await store.createGoal(
        GoalCreate.parse({ category: "business", title: "University", weekly_budget_minutes: 360 }),
      );
      // A new user in the memory store starts with the mock "Keep Sundays clear".
      const morning = zone.at(day, 10 * 60);
      await assert.rejects(
        () => bookGoalTime(goal.id, 90, morning),
        (err: unknown) =>
          err instanceof HttpError &&
          err.code === "conflict" &&
          err.message === "Sundays are kept clear, so no 90 minutes are left this week.",
      );
      const score = await scoreFor({ date: day, now: iso(morning) });
      assert.equal(score.free_minutes_left, 0);

      for (const i of await store.listInstructions()) await store.deleteInstruction(i.id);
      // Without the sample sleep goal the waking day is 07:00 to 23:00.
      for (const g of await store.listGoals()) if (g.id !== goal.id) await store.deleteGoal(g.id);
      // Without the rule the rest of the Sunday is free again, in the score as for Book.
      assert.ok((await scoreFor({ date: day, now: iso(morning) })).free_minutes_left >= 12 * 60);
      const rec = await bookGoalTime(goal.id, 90, zone.at(day, 22 * 60 + 10));
      assert.equal(rec.status, "done");
      assert.deepEqual(
        [rec.action?.payload.start_at, rec.action?.payload.end_at],
        [iso(zone.at(day, 22 * 60 + 15)), iso(zone.at(day, 23 * 60))],
      );
      assert.equal(
        rec.rationale,
        "Booked at your request through Goals. No free 90 minutes left this week, so I took 45 minutes. Undo in Michael until it starts.",
      );
    },
    "script",
  );
});
