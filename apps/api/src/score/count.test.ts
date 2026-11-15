import assert from "node:assert/strict";
import { test } from "node:test";
import type { CheckIn } from "@michael/shared";
import { type ChecklistItem, type Event, type Goal, Score } from "@michael/shared";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { Zone } from "../patterns/time";
import { type CountCheckIn, countCheckInsFrom } from "./check-in";
import { behindPace, countSessions } from "./count";
import { buildScore } from "./score";

// Count and checklist goals on the score (#238): the rule at the top of score/count.ts.

const zone = new Zone(DEFAULT_TIMEZONE);
const at = (day: string, time: string) => `2026-11-${day}T${time}:00+02:00`;
// Friday 13 Nov at noon: Friday, Saturday and Sunday are left.
const NOW = at("13", "12:00");

const goal = (p: Partial<Goal> & Pick<Goal, "id" | "title" | "category" | "target">): Goal => ({
  description: null,
  weekly_budget_minutes: null,
  active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  ...p,
});
const GYM = goal({
  id: "60000000-0000-4000-8000-000000000001",
  title: "Gym three times a week",
  category: "health",
  target: { kind: "count", per_week: 3, calendar_titles: ["Gym"] },
});
const OUTCOMES = goal({
  id: "60000000-0000-4000-8000-000000000002",
  title: "Today's outcomes",
  category: "business",
  target: { kind: "checklist" },
});
// A time goal that also lists Gym: its blocks are scored as before, and still count as sessions.
const TRAINING = goal({
  id: "60000000-0000-4000-8000-000000000003",
  title: "Training",
  category: "health",
  weekly_budget_minutes: 300,
  target: { kind: "time", calendar_titles: ["Gym", "Run"] },
});

let n = 0;
const ev = (p: Pick<Event, "type" | "start_at" | "end_at" | "title"> & Partial<Event>): Event => ({
  id: `70000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  source: "google_calendar",
  data: {},
  external_id: null,
  created_at: "2026-11-01T00:00:00.000Z",
  ...p,
});
const block = (day: string, from: string, to: string, title = "Gym") =>
  ev({ type: "calendar_event", start_at: at(day, from), end_at: at(day, to), title, data: { attendees: 0 } });
const workout = (day: string, from: string, to: string, title = "Strength training", data = {}) =>
  ev({
    source: "health_auto_export",
    type: "workout",
    start_at: at(day, from),
    end_at: at(day, to),
    title,
    data,
  });
const instagram = (day: string, from: string, to: string) =>
  ev({
    source: "iphone_usage",
    type: "app_usage",
    start_at: at(day, from),
    end_at: at(day, to),
    title: "Instagram",
    data: { bundle_id: "com.burbn.instagram", device: "iphone" },
  });
/** A yes with no span of its own: it stands for the day. */
const checkIn = (day: string, time: string, goalId = GYM.id): CountCheckIn => ({
  goal_id: goalId,
  event_id: null,
  start: Date.parse(at(day, time)),
  end: Date.parse(at(day, time)),
  untimed: true,
});

function count(events: Event[], countCheckIns: CountCheckIn[] = [], goals: Goal[] = [GYM], now = NOW) {
  const s = Score.parse(buildScore(events, goals, { date: "2026-11-13", now, countCheckIns }));
  const row = s.goals.find((g) => g.goal_id === GYM.id);
  assert.ok(row?.count, "a count goal has a count row");
  assert.equal(row.scored, false);
  assert.equal(row.checklist, undefined);
  return { row: row.count, score: s };
}

test("an own block counts once it has ended with at least half of it spent", () => {
  // No data at all: spent, so it counts. In progress or ahead: not yet.
  assert.equal(count([block("09", "18:00", "19:00")]).row.done, 1);
  assert.equal(count([block("13", "11:30", "12:30")]).row.done, 0);
  assert.equal(count([block("14", "10:00", "11:00")]).row.done, 0);
  // 40 of 60 minutes on Instagram: less than half spent, no session.
  assert.equal(count([block("10", "18:00", "19:00"), instagram("10", "18:00", "18:40")]).row.done, 0);
  // Exactly half spent counts.
  assert.equal(count([block("10", "18:00", "19:00"), instagram("10", "18:00", "18:30")]).row.done, 1);
  // A meeting called Gym is not an own block, and last week's block is not this week's.
  const meeting = block("09", "18:00", "19:00");
  meeting.data = { attendees: 2 };
  assert.equal(count([meeting, block("06", "18:00", "19:00")]).row.done, 0);
});

test("a workout counts when it is linked to the goal and has ended", () => {
  // By title, by data.goal_id, or inside one of the goal's blocks (even a block mostly lost).
  assert.equal(count([workout("09", "07:00", "08:00", "Gym")]).row.done, 1);
  assert.equal(count([workout("09", "07:00", "08:00", "Lifting", { goal_id: GYM.id })]).row.done, 1);
  assert.equal(
    count([block("10", "18:00", "19:00"), instagram("10", "18:00", "18:50"), workout("10", "18:05", "18:55")])
      .row.done,
    1,
  );
  // Not linked: a run with no block and no goal.
  assert.equal(count([workout("09", "07:00", "08:00", "Run")]).row.done, 0);
  // Still running at noon on Friday.
  assert.equal(count([workout("13", "11:30", "12:30", "Gym")]).row.done, 0);
});

test("a check in (#187) answered yes counts when it names the goal or one of its blocks", () => {
  // The question about Wednesday's Gym block names the time goal that also lists it, not GYM.
  const gymBlock = block("11", "18:00", "19:00");
  const q = (p: Partial<CheckIn>): CheckIn => ({
    id: crypto.randomUUID(),
    day: "2026-11-11",
    kind: "missed_block",
    question: "Gym, 18:00 to 19:00. No workout recorded. Did you train?",
    answer_type: "yes_no",
    moment: "evening",
    event_id: gymBlock.id,
    goal_id: TRAINING.id,
    start_at: gymBlock.start_at,
    end_at: gymBlock.end_at,
    follow_up_of: null,
    answer: "yes",
    label: null,
    asked_at: at("11", "20:00"),
    answered_at: at("11", "20:05"),
    ...p,
  });
  const answers = countCheckInsFrom([
    q({}),
    q({ answer: "no" }),
    q({ answer: 4, kind: "training" }),
    q({ goal_id: null, event_id: null }),
  ]);
  assert.equal(answers.length, 1);
  assert.deepEqual(answers[0], {
    goal_id: TRAINING.id,
    event_id: gymBlock.id,
    start: Date.parse(at("11", "18:00")),
    end: Date.parse(at("11", "19:00")),
    untimed: false,
  });
  // With the block it asks about mostly lost on Instagram, the yes alone makes the session.
  assert.equal(count([gymBlock, instagram("11", "18:00", "18:50")], answers, [GYM, TRAINING]).row.done, 1);
  // Linked by goal_id, with no block: one for the day.
  assert.equal(count([], [checkIn("10", "21:00")]).row.done, 1);
  // Another goal's answer, and one given after `now`, do not count.
  assert.equal(count([], [checkIn("11", "21:00", OUTCOMES.id), checkIn("13", "21:00")]).row.done, 0);
});

test("dedupe: overlapping sources count once, sessions hours apart count twice", () => {
  // The block, the watch's workout inside it and the evening yes: one session.
  const one = count(
    [block("09", "18:00", "19:00"), workout("09", "18:10", "18:55")],
    [checkIn("09", "21:30")],
  );
  assert.equal(one.row.done, 1);
  // Within an hour of each other on one day: one.
  assert.equal(count([workout("09", "07:00", "08:00", "Gym"), block("09", "08:45", "09:30")]).row.done, 1);
  // Morning and evening on one day: two. The evening check in adds nothing to a day with sessions.
  assert.equal(
    count([workout("09", "07:00", "08:00", "Gym"), block("09", "18:00", "19:00")], [checkIn("09", "21:00")])
      .row.done,
    2,
  );
  // The same times on two days: two. Two check ins on one day: one.
  assert.equal(count([block("09", "18:00", "19:00"), block("10", "18:00", "19:00")]).row.done, 2);
  assert.equal(count([], [checkIn("11", "20:00"), checkIn("11", "21:00")]).row.done, 1);
  assert.equal(
    countSessions(
      [
        { source: "block", start: 0, end: 10 },
        { source: "check_in", start: 5, end: 5 },
      ],
      zone,
    ),
    1,
  );
});

test("the count row: done, target, left and days left, and the pace", () => {
  const { row, score } = count([block("09", "18:00", "19:00")]);
  assert.deepEqual(row, { done: 1, target: 3, left: 2, days_left: 3 });
  assert.equal(behindPace(row), false);
  // Saturday evening, one done of three: two left, one day left.
  const late = count([block("09", "18:00", "19:00")], [], [GYM], at("14", "20:00")).row;
  assert.deepEqual(late, { done: 1, target: 3, left: 2, days_left: 2 });
  const sunday = count([block("09", "18:00", "19:00")], [], [GYM], at("15", "20:00")).row;
  assert.deepEqual(sunday, { done: 1, target: 3, left: 2, days_left: 1 });
  assert.equal(behindPace(sunday), true);
  // Outside the time score: no minutes anywhere.
  assert.deepEqual([score.planned_minutes, score.elapsed_minutes], [0, 0]);
  // Never below zero.
  const four = ["09", "10", "11", "12"].map((d) => block(d, "07:00", "08:00"));
  assert.deepEqual(count(four).row, { done: 4, target: 3, left: 0, days_left: 3 });
});

test("a block of a time goal still counts as a session, and stays in the time score", () => {
  const { row, score } = count([block("09", "18:00", "19:00")], [], [GYM, TRAINING]);
  assert.equal(row.done, 1);
  const training = score.goals.find((g) => g.goal_id === TRAINING.id);
  assert.deepEqual([training?.scored, training?.spent_minutes, training?.count], [true, 60, undefined]);
});

test("checklist rows: set and done today and this week, a carried item counted once", () => {
  const item = (
    p: Partial<ChecklistItem> & Pick<ChecklistItem, "id" | "date" | "status">,
  ): ChecklistItem => ({
    goal_id: OUTCOMES.id,
    text: "An outcome",
    position: 0,
    settled_at: null,
    settled_by: null,
    carried_from: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...p,
  });
  const id = (k: number) => `80000000-0000-4000-8000-00000000000${k}`;
  const checklist = [
    item({ id: id(1), date: "2026-11-12", status: "moved" }),
    item({ id: id(2), date: "2026-11-13", status: "open", carried_from: id(1) }),
    item({ id: id(3), date: "2026-11-13", status: "done", position: 1 }),
    item({ id: id(4), date: "2026-11-12", status: "dropped", position: 1 }),
    item({ id: id(5), date: "2026-11-10", status: "done" }),
    // Last week and another goal are not counted.
    item({ id: id(6), date: "2026-11-08", status: "done" }),
    item({ id: id(7), date: "2026-11-13", status: "done", goal_id: GYM.id }),
  ];
  const s = buildScore([], [OUTCOMES, GYM], { date: "2026-11-13", now: NOW, checklist });
  const row = s.goals.find((g) => g.goal_id === OUTCOMES.id);
  assert.deepEqual(row?.checklist, { today: { set: 2, done: 1 }, week: { set: 4, done: 2 } });
  assert.deepEqual([row?.scored, row?.count], [false, undefined]);
  // Without items the row is there with zeros.
  const empty = buildScore([], [OUTCOMES], { date: "2026-11-13", now: NOW }).goals[0];
  assert.deepEqual(empty?.checklist, { today: { set: 0, done: 0 }, week: { set: 0, done: 0 } });
});
