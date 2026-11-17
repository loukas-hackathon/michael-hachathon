import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookedLine,
  bookedSplit,
  bookMinutes,
  bookOffer,
  type GoalsView,
  type GoalWeek,
  isFreshWeek,
  paceKnown,
  rank,
  withoutPace,
} from "./goals-view";
import type { ScoreExplain } from "./score-explain";

// hm() keeps "1h 30" on one line with a no-break space: compare the words, not the kind of space.
const plain = (s: string | null) => s?.replace(/\u00a0/g, " ") ?? null;

test("what is left splits into what is booked ahead and what is still open", () => {
  // The demo week's 70.3: 1h 49 left, one 1h 30 block still to come.
  assert.deepEqual(bookedSplit(109, 90), { booked: 90, open: 19 });
  assert.equal(plain(bookedLine(109, 90)), "1h 30 booked, 19 minutes still open.");
  // Book is offered for the open part only.
  assert.equal(bookMinutes(bookedSplit(109, 90).open, 1), 30);
});

test("a block that covers what is left closes the goal, and nothing booked says nothing", () => {
  assert.deepEqual(bookedSplit(60, 90), { booked: 90, open: 0 });
  assert.equal(plain(bookedLine(60, 90)), "1h 30 booked. That closes it.");
  assert.equal(bookedLine(109, 0), null);
  assert.equal(bookedLine(0, 90), null);
});

// #513: a first day account on a Sunday, two starter goals, no goal block yet.
const explain = (over: Partial<ScoreExplain>): ScoreExplain => ({
  sample: false,
  scorePct: null,
  planned: 0,
  elapsed: 0,
  spent: 0,
  unverified: 0,
  lost: 0,
  ahead: 0,
  logged: 0,
  causes: [],
  wonBack: 0,
  usualLossRate: null,
  daysLearnt: 0,
  learning: true,
  ...over,
});
const goal = (id: string, budget: number, spent = 0): GoalWeek => ({
  id,
  title: id,
  category: "business",
  budgetMinutes: budget,
  spentMinutes: spent,
  unverifiedMinutes: 0,
  daily: [0, 0, 0, 0, 0, 0, 0],
});
const sunday = (over: Partial<GoalsView> = {}): GoalsView => ({
  sample: false,
  weekStart: "2026-11-09T00:00:00.000Z",
  now: "2026-11-15T15:00:00.000Z",
  freeMinutesLeft: null,
  goals: [goal("Deep work", 600), goal("Training", 240)],
  sleep: null,
  explain: explain({}),
  ...over,
});

test("first week: no pace verdict until a planned goal block has gone by", () => {
  const view = sunday();
  assert.equal(paceKnown(view), false);
  assert.equal(isFreshWeek(view), true);
  // rank alone would call both behind on a Sunday; without pace neither is.
  assert.ok(rank(view).every((r) => r.behind));
  assert.ok(withoutPace(rank(view)).every((r) => !r.behind));
  // Time logged outside a block is counted, still with no verdict.
  const logged = sunday({ goals: [goal("Deep work", 600, 30)] });
  assert.equal(paceKnown(logged), false);
  assert.equal(isFreshWeek(logged), false);
});

test("pace counts once a block has gone by, a day is learnt, or it is a sample", () => {
  assert.equal(paceKnown(sunday({ explain: explain({ planned: 90, elapsed: 90 }) })), true);
  assert.equal(paceKnown(sunday({ explain: explain({ daysLearnt: 1 }) })), true);
  assert.equal(paceKnown(sunday({ explain: explain({ learning: false }) })), true);
  assert.equal(paceKnown(sunday({ sample: true })), true);
  assert.equal(paceKnown(sunday(), "sample"), true);
  assert.equal(paceKnown(sunday({ explain: null })), true);
});

test("first week on its last day: plan next week, never a weekly budget crammed into today", () => {
  assert.deepEqual(bookOffer({ left: 600, booked: 0, toGo: 1, budget: 600, paceKnown: false }), {
    kind: "next_week",
    minutes: 90,
  });
  assert.deepEqual(bookOffer({ left: 240, booked: 0, toGo: 1, budget: 240, paceKnown: false }), {
    kind: "next_week",
    minutes: 45,
  });
  // Earlier in the first week, today's block is what is left over the days to go.
  assert.deepEqual(bookOffer({ left: 240, booked: 0, toGo: 4, budget: 240, paceKnown: false }), {
    kind: "today",
    minutes: 60,
  });
  // An established week keeps today's block on its last day, and booked time is never offered twice.
  assert.deepEqual(bookOffer({ left: 109, booked: 0, toGo: 1, budget: 600, paceKnown: true }), {
    kind: "today",
    minutes: 90,
  });
  assert.deepEqual(bookOffer({ left: 60, booked: 90, toGo: 1, budget: 600, paceKnown: false }), {
    kind: "booked",
  });
});
