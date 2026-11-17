import assert from "node:assert/strict";
import { test } from "node:test";
import { unionMs } from "./spans";

const m = 60_000;

test("overlapping phone spans count once: a second pick up before the first one's return", () => {
  // 10:00 to 10:12 and 10:05 to 10:20 cover 20 minutes, not 27.
  assert.equal(
    unionMs([
      [0, 12 * m],
      [5 * m, 20 * m],
    ]) / m,
    20,
  );
});

test("separate spans add up, in any order, and empty ones add nothing", () => {
  assert.equal(
    unionMs([
      [30 * m, 40 * m],
      [0, 5 * m],
      [50 * m, 50 * m],
    ]) / m,
    15,
  );
  assert.equal(unionMs([]), 0);
});

test("a span inside another adds nothing", () => {
  assert.equal(
    unionMs([
      [0, 30 * m],
      [10 * m, 20 * m],
    ]) / m,
    30,
  );
});
