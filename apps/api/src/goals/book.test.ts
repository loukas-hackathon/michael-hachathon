import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "@michael/shared";
import { goalSlot } from "./book";

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
