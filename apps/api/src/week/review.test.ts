import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ChecklistItem,
  type Event,
  type Goal,
  mockGoals,
  mockScore,
  type PersonalRecord,
  type Score,
  voiceProblems,
  WeekReview,
} from "@michael/shared";
import { calendar, T } from "../patterns/testkit";
import type { HistoryWeek, ScoreHistory } from "../score";
import { reviewFacts } from "./phrase";
import { computeReview, lessonFor, type ReviewInput, reviewGoals, usualScore, weekdayOf } from "./review";

// mockScore is a made up Wednesday 11 November 2026 (week of Monday 9th). The review reads it as
// it stood on Sunday evening.
const NOW = T("2026-11-15 19:00");
const DEEP = "10000000-0000-4000-8000-000000000001";
const EVENINGS = "10000000-0000-4000-8000-000000000005";
const OUTCOMES = "10000000-0000-4000-8000-000000000007";

const week = (week_start: string, pct: number | null, complete = true): HistoryWeek => ({
  week_start,
  complete,
  score_pct: pct,
  elapsed_minutes: 600,
  committed_minutes: 600,
  areas: {
    business: { score_pct: pct, elapsed_minutes: 400 },
    health: { score_pct: pct, elapsed_minutes: 200 },
    personal: { score_pct: null, elapsed_minutes: 0 },
  },
});

const history = (weeks: HistoryWeek[]): ScoreHistory => ({
  weeks,
  runs: [
    {
      event_id: "e1",
      goal_id: DEEP,
      goal_title: "4h of deep work per day",
      area: "business",
      day: "2026-11-10",
      end: Date.parse(T("2026-11-10 12:00")),
      minutes: 85,
      first_tick: 0,
      tick_minutes: [],
    },
    {
      event_id: "e0",
      goal_id: DEEP,
      goal_title: "4h of deep work per day",
      area: "business",
      day: "2026-11-02",
      end: Date.parse(T("2026-11-02 12:00")),
      minutes: 120,
      first_tick: 0,
      tick_minutes: [],
    },
  ],
});

const item = (date: string, status: ChecklistItem["status"], goal_id = OUTCOMES): ChecklistItem => ({
  id: crypto.randomUUID(),
  goal_id,
  date,
  text: "Outcome",
  position: 0,
  status,
  settled_at: null,
  settled_by: null,
  carried_from: null,
  linked_goal_id: null,
  estimate_minutes: null,
  logged_minutes: null,
  created_at: NOW,
  updated_at: NOW,
});

const logged = (start: string, end: string): Event => ({
  ...calendar("Logged", start, end),
  source: "manual",
  type: "focus_session",
  data: { log: "done", goal_id: EVENINGS },
});

const record = (achieved_on: string, previous_value: number | null): PersonalRecord => ({
  id: crypto.randomUUID(),
  type: "longest_block",
  area: "business",
  goal_id: DEEP,
  value: 85,
  unit: "minutes",
  previous_value,
  achieved_on,
  event_id: "e1",
  tick_index: 10,
  line: previous_value === null ? null : "1h 25 on deep work without a break. Your longest block yet.",
  announced_at: null,
  created_at: NOW,
});

const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  score: mockScore,
  history: history([week("2026-10-26", 60), week("2026-11-02", 70), week("2026-11-09", 64, false)]),
  goals: mockGoals as Goal[],
  records: [record("2026-11-10", 70), record("2026-11-11", null), record("2026-11-02", 60)],
  targets: [],
  events: [
    logged(T("2026-11-12 20:00"), T("2026-11-12 20:40")),
    logged(T("2026-11-05 20:00"), T("2026-11-05 21:00")),
  ],
  checklist: [
    item("2026-11-10", "done"),
    item("2026-11-10", "moved"),
    item("2026-11-11", "partly"),
    item("2026-11-12", "done"),
    item("2026-11-12", "done", DEEP),
  ],
  outcomesGoalId: OUTCOMES,
  nextEvents: [],
  instructions: [],
  now: NOW,
  ...over,
});

test("the review is the score's week, with the maths and the contract's shape", () => {
  const r = computeReview(input());
  assert.equal(r.week_start, "2026-11-09");
  assert.equal(r.week_end, "2026-11-15");
  assert.equal(r.complete, false);
  assert.equal(r.score.pct, 64);
  assert.equal(r.score.spent_minutes, 416);
  assert.equal(r.score.elapsed_minutes, 650);
  assert.equal(r.won_back_minutes, 47);
  // Usual: the median of the two full weeks before, the reviewed week left out.
  assert.equal(r.score.usual_pct, 65);
  assert.equal(r.score.usual_weeks, 2);
  // The biggest thief, with its share of the lost time: 148 of 234.
  assert.deepEqual(r.thief, { what: "Instagram", kind: "app", minutes: 148, share_pct: 63 });
  // Only done time entries that start in the week.
  assert.deepEqual(r.logged, { entries: 1, minutes: 40 });
  // Outcomes of the ritual's goal only, moved ones left out.
  assert.deepEqual(r.outcomes, { set: 3, done: 2 });
  // New bests set in the week only: no baseline, nothing from the week before.
  assert.deepEqual(
    r.records.map((x) => x.achieved_on),
    ["2026-11-10"],
  );
  // The longest run inside the week, record or not.
  assert.equal(r.best_block?.minutes, 85);
  assert.ok(WeekReview.safeParse({ ...r, phrased_by: "template" }).success);
});

test("goals: time goals by budget with logged time, count goals by sessions; targets and lists left out", () => {
  const score: Score = {
    ...mockScore,
    goals: mockScore.goals.map((g) =>
      g.goal_id === EVENINGS ? { ...g, spent_minutes: 120, logged_minutes: 60 } : g,
    ),
  };
  const rows = reviewGoals(score);
  assert.deepEqual(
    rows.map((g) => [g.title, g.kind, g.done, g.budget, g.kept, g.short]),
    [
      ["4h of deep work per day", "time", 366, 1200, false, 834],
      ["70.3 training: 9 hours this week", "time", 50, 540, false, 490],
      ["Evenings out", "time", 180, 180, true, 0],
      ["Gym twice a week", "count", 1, 2, false, 1],
    ],
  );
});

test("usual needs two full weeks", () => {
  assert.deepEqual(usualScore(history([week("2026-11-02", 70)]), "2026-11-09"), { pct: null, weeks: 1 });
  assert.deepEqual(
    usualScore(
      history([week("2026-10-26", 50), week("2026-11-02", null), week("2026-11-02", 80)]),
      "2026-11-09",
    ),
    { pct: 65, weeks: 2 },
  );
});

test("next week's target: the target rule with this week read as full on Sunday, or why not", () => {
  const r = computeReview(input());
  // Median of 60, 70 and 64 is 64; this week's 64 is at the usual, so it counts as on target.
  assert.equal(r.next_week.week_start, "2026-11-16");
  assert.equal(r.next_week.status, "proposed");
  assert.equal(typeof r.next_week.target_pct, "number");
  assert.match(r.next_week.reason ?? "", /Target \d+%\./);

  // On Saturday the week is not read as full yet: one full week only.
  const early = computeReview(
    input({
      now: T("2026-11-14 19:00"),
      history: history([week("2026-11-02", 70), week("2026-11-09", 64, false)]),
    }),
  );
  assert.equal(early.next_week.target_pct, null);
  assert.equal(early.next_week.reason, "I need two full weeks of scores before I set a target. I have one.");

  // A stored target for next Monday wins.
  const stored = computeReview(
    input({
      targets: [
        {
          week_start: "2026-11-16",
          overall_pct: 72,
          areas: { business: 70, health: 75, personal: null },
          floors: { business: 50, health: 50, personal: 50 },
          status: "accepted",
          set_by: "user",
          reason: "You set 72%. I proposed 69%.",
          basis: { weeks_used: 3, median_pct: 64, step: "up", on_target_weeks: 3, heavy_week: false },
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    }),
  );
  assert.deepEqual(stored.next_week, {
    week_start: "2026-11-16",
    target_pct: 72,
    status: "accepted",
    reason: "You set 72%. I proposed 69%.",
  });
});

test("next move: the goal furthest short, a fifth of its budget, first free slot on Monday", () => {
  const r = computeReview(input());
  const m = r.next_move;
  assert.ok(m);
  assert.equal(m.status, "book");
  assert.equal(m.goal_id, DEEP);
  // 1200 / 5 = 240, capped at 90.
  assert.equal(m.minutes, 90);
  // The sleep goal sets the waking day; Monday morning is free.
  assert.equal(weekdayOf("2026-11-16"), "Monday");
  assert.match(m.title, /^Book 90 minutes for 4h of deep work per day, Monday \d\d:\d\d$/);
  assert.match(m.rationale, /^4h of deep work per day is 13h 54 short this week\./);

  // A busy Monday morning pushes the slot past the meeting.
  const busy = computeReview(
    input({
      nextEvents: [calendar("Board", T("2026-11-16 00:00"), T("2026-11-16 12:00"), { attendees: 4 })],
    }),
  );
  assert.equal(busy.next_move?.start_at, new Date(T("2026-11-16 12:00")).toISOString());
});

test("next move: a goal block already booked next week is the first move", () => {
  const r = computeReview(
    input({
      nextEvents: [
        calendar("Evenings out", T("2026-11-17 19:00"), T("2026-11-17 21:00"), {
          goal_id: EVENINGS,
          attendees: 0,
        }),
      ],
    }),
  );
  assert.equal(r.next_move?.status, "booked");
  assert.equal(r.next_move?.title, "Evenings out, Tuesday 19:00");
  assert.equal(r.next_move?.minutes, 120);
});

test("lesson: the thief first, then the goal furthest short, then the plain line; voice rules hold", () => {
  const r = computeReview(input());
  assert.equal(
    r.lesson,
    "Instagram took 2h 28 of your goal blocks, 63% of all you lost. Keep it out of next week's blocks.",
  );
  const base = { ...r, thief: null, complete: true };
  assert.equal(
    lessonFor(base),
    "4h of deep work per day ended 13h 54 short. Book it before anything else next week.",
  );
  assert.equal(
    lessonFor({ ...base, goals: [] }),
    "Nothing lost from your goal blocks. Book next week the same way.",
  );
  assert.equal(
    lessonFor({ ...base, goals: [], score: { ...base.score, planned_minutes: 0 } }),
    "No goal time was booked this week. Book next week before Monday starts.",
  );
  for (const line of [r.lesson, lessonFor(base), r.next_move?.title ?? "", r.next_move?.rationale ?? ""]) {
    assert.deepEqual(voiceProblems(line), [], line);
  }
});

test("the model's facts hold every number in the template lesson", () => {
  const r = computeReview(input());
  const facts = reviewFacts(r);
  const known = new Set(facts.match(/\d+/g) ?? []);
  for (const n of r.lesson.match(/\d+/g) ?? []) assert.ok(known.has(n), n);
  // No dates: their digits would let a made up number through the guard.
  assert.doesNotMatch(facts, /2026/);
});
