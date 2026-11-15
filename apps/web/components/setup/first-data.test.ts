import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstDataLine,
  firstDataState,
  GIVE_UP_AFTER_MS,
  LATE_AFTER_MS,
  RECHECK,
  WAITING_LINE,
} from "./first-data";

const start = Date.parse("2026-11-15T10:00:00Z");

test("first data: waits, then names the step to recheck after two minutes, then stops", () => {
  assert.deepEqual(firstDataState(null, null, start, start + 10_000), { kind: "waiting" });
  assert.deepEqual(firstDataState(null, null, start, start + LATE_AFTER_MS), { kind: "late" });
  assert.deepEqual(firstDataState(null, null, start, start + GIVE_UP_AFTER_MS), { kind: "stopped" });
  assert.equal(firstDataLine("apple-watch", { kind: "waiting" }, start), WAITING_LINE);
  assert.equal(firstDataLine("apple-watch", { kind: "late" }, start), RECHECK["apple-watch"]);
});

test("first data: only an arrival newer than the baseline counts", () => {
  const old = "2026-11-14T09:00:00Z";
  // Data from yesterday is not proof that today's setup works.
  assert.deepEqual(firstDataState(old, old, start, start + 30_000), { kind: "waiting" });
  const fresh = "2026-11-15T10:01:00Z";
  assert.deepEqual(firstDataState(old, fresh, start, start + 90_000), { kind: "arrived", at: fresh });
  assert.deepEqual(firstDataState(null, fresh, start, start + 90_000), { kind: "arrived", at: fresh });
  // An arrival beats the late and stopped states.
  assert.equal(firstDataState(null, fresh, start, start + GIVE_UP_AFTER_MS).kind, "arrived");
});

test("first data: the connected line shows the maths in plain words", () => {
  const at = "2026-11-15T10:00:00Z";
  assert.equal(
    firstDataLine("iphone", { kind: "arrived", at }, start + 20_000),
    "Connected. Last data just now.",
  );
  assert.equal(
    firstDataLine("apple-watch", { kind: "arrived", at }, start + 2 * 60_000),
    "Connected. Last data 2 min ago.",
  );
});
