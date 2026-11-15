import assert from "node:assert/strict";
import { test } from "node:test";
import { inQuietHours } from "./quiet-hours";

const night = { start: "22:00", end: "07:00" };

// Athens is UTC+2 in November.
test("quiet hours cross midnight on the Athens clock", () => {
  assert.equal(inQuietHours(night, new Date("2026-11-15T23:30:00+02:00")), true);
  assert.equal(inQuietHours(night, new Date("2026-11-16T06:59:00+02:00")), true);
  assert.equal(inQuietHours(night, new Date("2026-11-16T07:00:00+02:00")), false);
  assert.equal(inQuietHours(night, new Date("2026-11-15T21:59:00+02:00")), false);
});

test("a window inside one day, and an empty one", () => {
  const lunch = { start: "13:00", end: "14:00" };
  assert.equal(inQuietHours(lunch, new Date("2026-11-15T13:30:00+02:00")), true);
  assert.equal(inQuietHours(lunch, new Date("2026-11-15T14:00:00+02:00")), false);
  assert.equal(inQuietHours({ start: "09:00", end: "09:00" }, new Date("2026-11-15T09:00:00+02:00")), false);
});
