import assert from "node:assert/strict";
import { test } from "node:test";
import { formatUntil } from "./format";

// Athens is UTC+2 in November.
const now = new Date("2026-11-15T06:43:00+02:00");

test("an undo deadline names the day when it is not today", () => {
  assert.equal(formatUntil("2026-11-15T15:00:00+02:00", now), "15:00");
  // A logged entry: undoable for 24 hours, so the bare clock would read as already over.
  assert.equal(formatUntil("2026-11-16T06:43:00+02:00", now), "tomorrow 06:43");
  assert.equal(formatUntil("2026-11-18T09:30:00+02:00", now), "Wednesday 09:30");
  // Just before midnight Athens time is still today.
  assert.equal(formatUntil("2026-11-15T23:59:00+02:00", now), "23:59");
});
