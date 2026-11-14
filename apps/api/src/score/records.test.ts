import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type PersonalRecord, voiceProblems } from "@michael/shared";
import {
  type BlockRun,
  currentRecords,
  detectRecords,
  type NewRecord,
  type RecordWeek,
  recordLine,
} from "./records";

// The record rule (score/records.ts): a baseline first, a new best once, equal is not a record.

const week = (week_start: string, score: number | null, opts: Partial<RecordWeek> = {}): RecordWeek => ({
  week_start,
  complete: true,
  score_pct: score,
  elapsed_minutes: 600,
  areas: {
    business: { score_pct: score, elapsed_minutes: 300 },
    health: { score_pct: score, elapsed_minutes: 300 },
    personal: { score_pct: null, elapsed_minutes: 0 },
  },
  ...opts,
});

/** What the store does: give each new record an id, skip a key it already holds. */
function stored(all: (PersonalRecord & { key: string })[], fresh: NewRecord[]) {
  for (const r of fresh) {
    if (all.some((x) => x.key === r.key)) continue;
    all.push({ ...r, id: randomUUID(), announced_at: null, created_at: "2026-11-02T00:00:00.000Z" });
  }
  return all;
}

const run = (day: string, minutes: number, first = 0): BlockRun => ({
  event_id: `event-${day}`,
  goal_id: "10000000-0000-4000-8000-000000000001",
  goal_title: "The company",
  area: "business",
  day,
  end: Date.parse(`${day}T12:00:00Z`),
  minutes,
  first_tick: first,
  tick_minutes: Array.from({ length: Math.ceil(minutes / 5) }, (_, i) => Math.min(5, minutes - i * 5)),
});

test("the first week is a baseline: stored without a line, never announced", () => {
  const fresh = detectRecords({ weeks: [week("2026-10-26", 64)], runs: [], stored: [] });
  assert.deepEqual(
    fresh.map((r) => [r.type, r.area, r.value, r.previous_value, r.line]).sort(),
    [
      ["best_week", null, 64, null, null],
      ["best_week_area", "business", 64, null, null],
      ["best_week_area", "health", 64, null, null],
    ].sort(),
  );
  // A week still running, or with less than two hours elapsed, sets nothing.
  assert.deepEqual(
    detectRecords({ weeks: [week("2026-11-02", 90, { complete: false })], runs: [], stored: [] }),
    [],
  );
  assert.deepEqual(
    detectRecords({
      weeks: [week("2026-11-02", 100, { elapsed_minutes: 30, areas: week("x", null).areas })],
      runs: [],
      stored: [],
    }),
    [],
  );
});

test("a new best is detected once, and an equal value is not a record", () => {
  const all = stored([], detectRecords({ weeks: [week("2026-10-26", 64)], runs: [], stored: [] }));
  // The next week beats it: one record per scope, with the line and the old best.
  const weeks = [week("2026-10-26", 64), week("2026-11-02", 71)];
  const fresh = detectRecords({ weeks, runs: [], stored: all });
  const best = fresh.find((r) => r.type === "best_week");
  assert.deepEqual([best?.value, best?.previous_value, best?.achieved_on], [71, 64, "2026-11-02"]);
  assert.equal(best?.line, "Best week since you started. 71%. Do it again.");
  const health = fresh.find((r) => r.area === "health");
  assert.equal(health?.line, "Best Health week since you started. 71%. Do it again.");
  stored(all, fresh);
  // Read again: nothing new.
  assert.deepEqual(detectRecords({ weeks, runs: [], stored: all }), []);
  // A later week equal to the best is not a record.
  assert.deepEqual(detectRecords({ weeks: [...weeks, week("2026-11-09", 71)], runs: [], stored: all }), []);
  // Two better weeks in a row: each is a record over the one before.
  const two = detectRecords({
    weeks: [week("2026-11-09", 73), week("2026-11-16", 75)],
    runs: [],
    stored: all,
  }).filter((r) => r.type === "best_week");
  assert.deepEqual(
    two.map((r) => [r.value, r.previous_value]),
    [
      [73, 71],
      [75, 73],
    ],
  );
});

test("the longest block: a baseline, then a new best with the tick where the old one was passed", () => {
  const all = stored(
    [],
    detectRecords({ weeks: [], runs: [run("2026-11-09", 60), run("2026-11-10", 45)], stored: [] }),
  );
  assert.equal(all.length, 1);
  assert.deepEqual(
    [all[0]?.value, all[0]?.line, all[0]?.tick_index, all[0]?.event_id],
    [60, null, null, "event-2026-11-09"],
  );

  // 90 minutes starting at the block's third tick: the old 60 is passed in its 13th tick (65).
  const fresh = detectRecords({
    weeks: [],
    runs: [run("2026-11-11", 90, 2), run("2026-11-11", 60)],
    stored: all,
  });
  assert.equal(fresh.length, 1);
  const r = fresh[0];
  assert.deepEqual(
    [
      r?.type,
      r?.area,
      r?.goal_id,
      r?.value,
      r?.unit,
      r?.previous_value,
      r?.achieved_on,
      r?.event_id,
      r?.tick_index,
    ],
    [
      "longest_block",
      "business",
      "10000000-0000-4000-8000-000000000001",
      90,
      "minutes",
      60,
      "2026-11-11",
      "event-2026-11-11",
      14,
    ],
  );
  assert.equal(r?.line, "90 minutes on The company without a break. Your longest block yet.");
  stored(all, fresh);
  assert.deepEqual(detectRecords({ weeks: [], runs: [run("2026-11-11", 90, 2)], stored: all }), []);
  // Short runs never count.
  assert.deepEqual(detectRecords({ weeks: [], runs: [run("2026-11-12", 10)], stored: [] }), []);
});

test("every line is under 15 words and in the voice", () => {
  const lines = [
    recordLine({ type: "best_week", area: null, value: 74 }),
    recordLine({ type: "best_week_area", area: "personal", value: 58 }),
    recordLine({ type: "longest_block", area: "health", value: 135 }, "70.3"),
    recordLine(
      { type: "longest_block", area: "health", value: 135 },
      "a very long goal title that goes on and on and on",
    ),
  ];
  assert.equal(lines[2], "2h 15 on 70.3 without a break. Your longest block yet.");
  assert.equal(lines[3], "2h 15 without a break. Your longest block yet.");
  for (const line of lines) {
    assert.ok(line.split(/\s+/).length < 15, line);
    assert.deepEqual(voiceProblems(line), [], line);
  }
});

test("the list: the current best of each scope, plus any not yet announced", () => {
  const all = stored(
    [],
    detectRecords({ weeks: [week("2026-10-26", 64)], runs: [run("2026-10-27", 60)], stored: [] }),
  );
  stored(
    all,
    detectRecords({ weeks: [week("2026-10-26", 64), week("2026-11-02", 71)], runs: [], stored: all }),
  );
  stored(all, detectRecords({ weeks: [week("2026-11-09", 75)], runs: [], stored: all }));
  const announced = all.find((r) => r.type === "best_week" && r.value === 71);
  if (announced) announced.announced_at = "2026-11-09T08:00:00.000Z";
  const list = currentRecords(all);
  const best = list.filter((r) => r.type === "best_week").map((r) => r.value);
  // 64 is a baseline, 71 was announced and beaten, 75 is the best.
  assert.deepEqual(best, [75]);
  assert.ok(list.some((r) => r.type === "longest_block" && r.value === 60));
  // The beaten Health record from 2 November is not announced yet, so it stays listed.
  assert.deepEqual(
    list.filter((r) => r.area === "health").map((r) => r.value),
    [71, 75],
  );
});
