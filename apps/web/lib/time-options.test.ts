import assert from "node:assert/strict";
import { test } from "node:test";
import { HOURS, minuteOptions } from "./time-options";

test("hours run 00 to 23, never AM or PM", () => {
  assert.equal(HOURS.length, 24);
  assert.equal(HOURS[0], "00");
  assert.equal(HOURS[23], "23");
});

test("minutes come in 15 minute steps, keeping a time that falls between", () => {
  assert.deepEqual(minuteOptions(15), ["00", "15", "30", "45"]);
  assert.deepEqual(minuteOptions(15, "30"), ["00", "15", "30", "45"]);
  assert.deepEqual(minuteOptions(15, "05"), ["00", "05", "15", "30", "45"]);
  assert.equal(minuteOptions(5).length, 12);
});
