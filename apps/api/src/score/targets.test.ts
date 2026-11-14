import assert from "node:assert/strict";
import { test } from "node:test";
import { type GoalArea, type ScoreArea, voiceProblems } from "@michael/shared";
import { balance, baselineOf, proposeTarget, TARGET_RULES, type TargetWeek } from "./targets";

// The target rule (score/targets.ts): the median of the last four full weeks, a step of at most
// 5 points, the cold start, the heavy week and the balanced week.

const ALL: ReadonlySet<GoalArea> = new Set(["business", "health", "personal"]);
const MONDAYS = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
const TARGET_WEEK = "2026-11-02";

/** A full week: the overall score and the same score in every category unless given. */
const week = (
  week_start: string,
  score: number,
  opts: Partial<Omit<TargetWeek, "week_start" | "score_pct">> = {},
): TargetWeek => ({
  week_start,
  complete: true,
  score_pct: score,
  areas: { business: score, health: score, personal: score },
  committed_minutes: 1200,
  target: null,
  ...opts,
});

const stored = (overall: number) => ({
  overall_pct: overall,
  areas: { business: overall, health: overall, personal: overall },
  floors: { business: 50, health: 50, personal: 50 },
});

const propose = (history: TargetWeek[], committed = 1200, timeAreas = ALL) =>
  proposeTarget({ week_start: TARGET_WEEK, history, timeAreas, committed_minutes: committed });

test("the median of the last four full weeks, raised by at most 5 points", () => {
  // Every week met a stored target of 55: up 5 from the median of 60, 62, 66, 70 (64).
  const history = [60, 62, 70, 66].map((s, i) => week(MONDAYS[i] as string, s, { target: stored(55) }));
  const { proposal, baseline } = propose(history);
  assert.equal(baseline.ready, true);
  assert.equal(proposal?.basis.median_pct, 64);
  assert.equal(proposal?.basis.step, "up");
  assert.equal(proposal?.overall_pct, 69);
  assert.deepEqual(proposal?.areas, { business: 69, health: 69, personal: 69 });
  assert.deepEqual([proposal?.status, proposal?.set_by], ["proposed", "michael"]);
  assert.equal(proposal?.reason, "Usual week 64%. You hit 4 of the last 4, so up 5. Target 69%.");

  // A week older than the last four does not count, nor one that has not ended.
  const longer = [
    week("2026-09-28", 10, { target: stored(5) }),
    ...history,
    week(TARGET_WEEK, 99, { complete: false }),
  ];
  assert.equal(propose(longer).proposal?.overall_pct, 69);
  assert.equal(propose(longer).proposal?.basis.weeks_used, 4);
});

test("the cap: 3 points from a median of 70, and never over 100", () => {
  const high = [80, 82, 84, 86].map((s, i) => week(MONDAYS[i] as string, s, { target: stored(70) }));
  assert.equal(propose(high).proposal?.overall_pct, 83 + TARGET_RULES.stepUpHigh);
  const top = [99, 100, 100, 99].map((s, i) => week(MONDAYS[i] as string, s, { target: stored(90) }));
  assert.equal(propose(top).proposal?.overall_pct, 100);
  for (const h of [high, top]) {
    const p = propose(h).proposal;
    assert.ok(p && p.overall_pct - (p.basis.median_pct ?? 0) <= TARGET_RULES.stepUp);
  }
});

test("cold start: no proposal until two full weeks exist, and the baseline says so", () => {
  for (const history of [[], [week(MONDAYS[3] as string, 70)]]) {
    const { proposal, baseline } = propose(history);
    assert.equal(proposal, null);
    assert.equal(baseline.ready, false);
    assert.equal(baseline.needed, 2);
    assert.equal(baseline.full_weeks, history.length);
    assert.match(baseline.reason ?? "", /^I need two full weeks of scores before I set a target\./);
    assert.deepEqual(voiceProblems(baseline.reason ?? ""), []);
  }
  // A week without a score or one still running is not a full week.
  const { baseline } = propose([
    week(MONDAYS[2] as string, 70),
    { ...week(MONDAYS[3] as string, 0), score_pct: null },
    week(TARGET_WEEK, 80, { complete: false }),
  ]);
  assert.deepEqual([baseline.ready, baseline.full_weeks], [false, 1]);
  assert.deepEqual(baselineOf(2), { ready: true, full_weeks: 2, needed: 2, reason: null });
});

test("step up after three of four on target, hold after two, down after one or none", () => {
  // Stored target 60 every week; the misses are spread so no two come in a row.
  const at = (scores: number[]) =>
    scores.map((s, i) => week(MONDAYS[i] as string, s, { target: stored(60) }));
  const up = propose(at([50, 62, 64, 66])).proposal;
  assert.deepEqual([up?.basis.step, up?.basis.on_target_weeks, up?.overall_pct], ["up", 3, 68]);
  const hold = propose(at([50, 62, 55, 66])).proposal;
  assert.deepEqual([hold?.basis.step, hold?.basis.on_target_weeks, hold?.overall_pct], ["hold", 2, 59]);
  assert.equal(hold?.reason, "Usual week 59%. You hit 2 of the last 4, so we hold. Target 59%.");
  const down = propose(at([50, 55, 61, 52])).proposal;
  assert.deepEqual([down?.basis.step, down?.basis.on_target_weeks, down?.overall_pct], ["down", 1, 51]);
  // Without stored targets a week is judged against the usual week: at or above the median hits.
  const plain = propose([40, 50, 60, 70].map((s, i) => week(MONDAYS[i] as string, s))).proposal;
  assert.deepEqual([plain?.basis.on_target_weeks, plain?.basis.step], [2, "hold"]);
});

test("two missed weeks in a row step down, with the reason My target was too high.", () => {
  // Three of four on target would step up, but the last two missed their targets.
  const history = [
    week(MONDAYS[0] as string, 70, { target: stored(60) }),
    week(MONDAYS[1] as string, 72, { target: stored(60) }),
    week(MONDAYS[2] as string, 60, { target: stored(75) }),
    week(MONDAYS[3] as string, 62, { target: stored(75) }),
  ];
  const p = propose(history).proposal;
  assert.equal(p?.basis.step, "down");
  assert.equal(p?.overall_pct, 66 - TARGET_RULES.stepDown);
  assert.ok(p?.reason.startsWith("My target was too high."));
  assert.equal(
    p?.reason,
    "My target was too high. Usual week 66%. Two weeks missed in a row, so down 3. Target 63%.",
  );
});

test("a heavy week lowers the proposal, with the reason in one line", () => {
  const history = [60, 62, 64, 66].map((s, i) => week(MONDAYS[i] as string, s, { target: stored(55) }));
  const normal = propose(history, 1300).proposal;
  assert.equal(normal?.basis.heavy_week, false);
  // 31 hours of fixed time against a usual 20: 3 more points off.
  const heavy = propose(history, 31 * 60).proposal;
  assert.equal(heavy?.basis.heavy_week, true);
  assert.equal(heavy?.overall_pct, (normal?.overall_pct ?? 0) - TARGET_RULES.heavyDown);
  assert.equal(
    heavy?.reason,
    "Usual week 63%. You hit 4 of the last 4, so up 5. Your week already holds 31h of fixed time, 11h over usual, so down 3 more. Target 65%.",
  );
  assert.ok(!heavy?.reason.includes("\n"));
  assert.deepEqual(voiceProblems(heavy?.reason ?? ""), []);
});

test("categories: their own median, the overall when short of history, null without time goals", () => {
  const history = MONDAYS.map((m, i) =>
    week(m, 60, {
      areas: { business: 80 + i, health: i < 3 ? null : 70, personal: 40 },
    }),
  );
  const p = propose(history, 1200, new Set<GoalArea>(["business", "health"])).proposal;
  assert.equal(p?.areas.personal, null);
  // Health has one full week of its own: it takes the overall proposal.
  assert.equal(p?.areas.health, p?.overall_pct);
  // Business: median 82 (81.5 rounded), two of four at or above it, hold.
  assert.equal(p?.areas.business, 82);
  // Floors carry over from the latest stored target.
  const edited = propose([
    week(MONDAYS[2] as string, 60),
    week(MONDAYS[3] as string, 60, {
      target: { ...stored(55), floors: { business: 60, health: 40, personal: 30 } },
    }),
  ]).proposal;
  assert.deepEqual(edited?.floors, { business: 60, health: 40, personal: 30 });
});

const area = (a: GoalArea, score: number | null): ScoreArea => ({
  area: a,
  goal_ids: [],
  planned_minutes: 600,
  elapsed_minutes: score === null ? 0 : 300,
  spent_minutes: 0,
  lost_minutes: 0,
  ahead_minutes: 0,
  unverified_minutes: 0,
  score_pct: score,
});

const target = {
  overall_pct: 65,
  areas: { business: 70, health: 62, personal: 55 },
  floors: { business: 50, health: 50, personal: 50 },
  status: "accepted" as const,
  set_by: "michael" as const,
};

test("a lopsided week is not on target: business 91, personal 12", () => {
  const areas = [area("business", 91), area("health", 63), area("personal", 12)];
  const b = balance(areas, 70, ALL, target);
  assert.equal(b.on_target, false);
  assert.deepEqual(
    b.areas.map((a) => [a.area, a.target_pct, a.floor_pct, a.meets_floor]),
    [
      ["business", 70, 50, true],
      ["health", 62, 50, true],
      ["personal", 55, 50, false],
    ],
  );
  // Balanced and at the target: on target.
  assert.equal(
    balance([area("business", 70), area("health", 63), area("personal", 55)], 65, ALL, target).on_target,
    true,
  );
  // At the target overall but a category with time goals and nothing elapsed in it: not a win.
  assert.equal(
    balance([area("business", 90), area("health", 63), area("personal", null)], 80, ALL, target).on_target,
    false,
  );
  // A category with no time goals has no floor to meet.
  const two = new Set<GoalArea>(["business", "health"]);
  const without = balance(
    [area("business", 90), area("health", 63), area("personal", null)],
    80,
    two,
    target,
  );
  assert.deepEqual(
    [without.on_target, without.areas[2]?.meets_floor, without.areas[2]?.target_pct],
    [true, null, null],
  );
  // Without a target the floors still apply, and there is no verdict.
  const none = balance(areas, 70, ALL, null);
  assert.deepEqual([none.on_target, none.areas[2]?.meets_floor, none.areas[2]?.floor_pct], [null, false, 50]);
  // Before anything has elapsed: no verdict and no floors met or missed.
  const early = balance(
    [area("business", null), area("health", null), area("personal", null)],
    null,
    ALL,
    target,
  );
  assert.deepEqual([early.on_target, early.areas.map((a) => a.meets_floor)], [null, [null, null, null]]);
});
