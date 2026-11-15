import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDayLabel, formatStamp, formatUntil, sameAthensDay } from "./format";

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

// Sunday 15 November 2026, 12:48 Athens.
const sunday = new Date("2026-11-15T12:48:00+02:00");

test("a chat line from another day says which day (#483)", () => {
  assert.equal(formatStamp("2026-11-15T12:48:00+02:00", sunday), "12:48");
  assert.equal(formatStamp("2026-11-15T00:05:00+02:00", sunday), "00:05");
  assert.equal(formatStamp("2026-11-14T21:44:00+02:00", sunday), "Yesterday 21:44");
  assert.equal(formatStamp("2026-11-12T09:30:00+02:00", sunday), "Thu 09:30");
  assert.equal(formatStamp("2026-11-02T09:30:00+02:00", sunday), "2 Nov 09:30");
  // 23:30 UTC on Saturday is already Sunday in Athens.
  assert.equal(formatStamp("2026-11-14T23:30:00Z", sunday), "01:30");
});

test("the day separator and same day check use Athens days", () => {
  assert.equal(formatDayLabel("2026-11-15T08:00:00+02:00", sunday), "Today");
  assert.equal(formatDayLabel("2026-11-14T21:44:00+02:00", sunday), "Yesterday");
  assert.equal(formatDayLabel("2026-11-12T21:44:00+02:00", sunday), "Thursday");
  assert.equal(formatDayLabel("2026-11-02T21:44:00+02:00", sunday), "2 Nov");
  assert.equal(sameAthensDay("2026-11-14T21:44:00+02:00", "2026-11-15T12:48:00+02:00"), false);
  assert.equal(sameAthensDay("2026-11-14T22:30:00Z", "2026-11-15T12:48:00+02:00"), true);
});
