import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceProblems } from "@michael/shared";
import type { GoalStatus, GoalWeek } from "./goals-view";
import type { KeepDay, KeepWeek } from "./keep-day";
import type { LostWeek } from "./lost-week";
import {
  askClaudeLine,
  calendarMissingLine,
  emptyDayLines,
  furthestBehind,
  listNames,
  logTimePreview,
  noBlocksLine,
  noBriefLine,
  numbersLine,
  setupWhy,
  streakLine,
  weekdayIndex,
  weekRowPreview,
} from "./today-lines";

const goal = (title: string, budget: number, spent: number): GoalWeek => ({
  id: title.toLowerCase().replace(/\s/g, "-"),
  title,
  category: "business",
  budgetMinutes: budget,
  spentMinutes: spent,
  unverifiedMinutes: 0,
  daily: [],
});
const status = (g: GoalWeek, behind: boolean): GoalStatus => ({
  goal: g,
  share: g.spentMinutes / g.budgetMinutes,
  behindBy: behind ? 0.2 : -0.1,
  leftMinutes: Math.max(0, g.budgetMinutes - g.spentMinutes),
  behind,
});

const company = status(goal("The company", 900, 400), true);
const uni = status(goal("University", 300, 280), false);
const ranked = [company, uni];

const lost: LostWeek = {
  date: "2026-11-15",
  total: 297,
  causes: [{ what: "Instagram", minutes: 152 }],
} as LostWeek;

/** Every line Michael says here keeps the voice: no dashes, no banned words, no exclamation marks. */
const clean = (line: string | null | undefined) => {
  assert.ok(line, "a line");
  assert.deepEqual(voiceProblems(line), [], line);
};

test("lines name the person's own goal furthest behind, with what is left", () => {
  assert.equal(furthestBehind(ranked), company);
  assert.equal(
    noBlocksLine(company),
    "No goal blocks today, so the run is safe. The company still has 8h 20 to go this week.",
  );
  assert.equal(weekRowPreview(ranked, 4), "The company is furthest behind: 8h 20 to go, 3 days left.");
  assert.equal(
    weekRowPreview(ranked, 6),
    "The company is furthest behind: 8h 20 to go, and today is the last day.",
  );
  assert.equal(weekRowPreview([uni], 2), "Every goal on pace. University has 20 minutes to go.");
  assert.equal(weekRowPreview([], 2), null);
  for (const l of [noBlocksLine(company), weekRowPreview(ranked, 4), weekRowPreview([uni], 2)]) clean(l);
});

test("the brief and Ask Claude start from the person's biggest loss this week", () => {
  assert.equal(
    noBriefLine({ lost, blocksToday: 2, top: company }),
    "None yet. I start with the 2h 32 Instagram took this week.",
  );
  assert.equal(
    noBriefLine({ lost: null, blocksToday: 2, top: company }),
    "None yet. I start with your 2 goal blocks today.",
  );
  assert.equal(
    noBriefLine({ lost: null, blocksToday: 0, top: company }),
    "None yet. I start with The company, furthest behind this week.",
  );
  assert.equal(
    askClaudeLine({ connected: true, lost, weekPct: 76 }),
    "Instagram took 2h 32 of your goal blocks this week. Ask Claude why.",
  );
  assert.equal(
    askClaudeLine({ connected: false, lost: null, weekPct: 76 }),
    "Want to know what moves your 76%? Connect Claude.",
  );
  assert.equal(askClaudeLine({ connected: true, lost: null, weekPct: null }), null);
  clean(noBriefLine({ lost, blocksToday: 0, top: null }));
  clean(askClaudeLine({ connected: false, lost, weekPct: 76 }));
});

test("log time names a goal: the one furthest behind, else one by the day of the week", () => {
  const goals = [
    { id: "the-company", title: "The company" },
    { id: "university", title: "University" },
  ];
  assert.equal(
    logTimePreview(goals, company, 0),
    "Did The company happen outside a block? Tell me how long.",
  );
  assert.equal(logTimePreview(goals, null, 1), "Did University happen outside a block? Tell me how long.");
  assert.equal(logTimePreview(goals, null, 2), "Did The company happen outside a block? Tell me how long.");
});

const keep = (states: KeepDay["state"][], over: Partial<KeepWeek> = {}): KeepWeek => ({
  today: `2026-11-${String(9 + states.indexOf("open") + (states.includes("open") ? 0 : 6)).padStart(2, "0")}`,
  line: 70,
  lineFromTarget: false,
  days: states.map((state, i) => ({
    date: `2026-11-${String(9 + i).padStart(2, "0")}`,
    planned: 60,
    spent: 0,
    pct: 0,
    state,
    rest: false,
  })),
  streak: 0,
  need: 40,
  restDays: [],
  ...over,
});

test("no run: the days kept this week and the last of them, not the same sentence all week", () => {
  const week = keep(["kept", "kept", "missed", "kept", "missed", "open", "future"]);
  assert.equal(streakLine(week), "3 days kept this week, the last on Thursday. Today starts the next run.");
  const none = keep(["missed", "missed", "open", "future", "future", "future", "future"]);
  assert.equal(streakLine(none), "No day kept yet this week. Today can be the first.");
  const monday = keep(["open", "future", "future", "future", "future", "future", "future"]);
  assert.equal(streakLine(monday), "Keep today to start the week's run.");
  assert.equal(streakLine({ ...week, streak: 2 }), "2 days kept in a row.");
  for (const w of [week, none, monday]) clean(streakLine(w));
});

test("numbers: the one figure worse than usual leads, nothing when all are usual", () => {
  assert.equal(
    numbersLine([
      { name: "Sleep score", tone: "usual" },
      { name: "Phone after 23:45", tone: "worse" },
      { name: "Recovery", tone: "better" },
    ]),
    "Phone after 23:45 is the one worse than your usual. Tap it for the fix.",
  );
  assert.equal(
    numbersLine([
      { name: "Recovery", tone: "worse" },
      { name: "Sleep score", tone: "worse" },
    ]),
    "2 worse than your usual. Start with Recovery.",
  );
  assert.equal(
    numbersLine([{ name: "Recovery", tone: "better" }]),
    "Recovery better than your usual, none worse.",
  );
  assert.equal(numbersLine([{ name: "Recovery", tone: "usual" }]), null);
});

test("a new account: each step says why for this person's goals and week, never what it is", () => {
  const goals = [
    { title: "Deep work", budgetMinutes: 600, category: "business" },
    { title: "Training", budgetMinutes: 240, category: "health" },
  ];
  assert.equal(
    setupWhy("goals", [], 0),
    "7 days left this week. Pick two or three goals and I plan them in.",
  );
  assert.equal(
    setupWhy("goals", [], 6),
    "Last day of the week. Pick two or three goals and we start Monday clean.",
  );
  assert.equal(
    setupWhy("calendar", goals, 2),
    "14h a week for Deep work and Training. I measure it against the blocks in your calendar.",
  );
  assert.equal(
    setupWhy("watch", goals, 2),
    "How you slept decides how Deep work goes. The watch tells me which days to push.",
  );
  assert.equal(
    setupWhy("watch", [{ title: "Sleep", category: "health" }], 2),
    "Sleep is one of your goals. The watch tells me how the nights really go.",
  );
  assert.equal(setupWhy("nudges", goals, 2), "Up to five a day, when a Deep work block starts or slips.");
  for (const key of ["goals", "calendar", "watch", "mac", "iphone", "nudges", "claude"] as const) {
    clean(setupWhy(key, goals, 3));
    clean(setupWhy(key, [], 3));
  }
});

test("the empty day names the goal that needs today, and the calendar what it costs", () => {
  assert.deepEqual(emptyDayLines(company, 4), {
    title: "Nothing booked for The company today.",
    line: "8h 20 of its 15h still to go with 3 days left. Say the word and I'll find a block.",
    cta: "Plan The company today",
  });
  assert.equal(emptyDayLines(null, 4).cta, "Plan today with Michael");
  assert.equal(
    calendarMissingLine([{ title: "Deep work", budgetMinutes: 600 }]),
    "10h a week for Deep work is guesswork until I see your calendar.",
  );
  clean(emptyDayLines(company, 6).line);
  clean(calendarMissingLine([]));
});

test("helpers: names in a list, and the day of the week in Athens", () => {
  assert.equal(listNames(["A", "B", "C"]), "A, B and C");
  assert.equal(listNames(["A"]), "A");
  // Sunday 23:30 in Athens is still Sunday, though it is Sunday 21:30 in UTC.
  assert.equal(weekdayIndex("2026-11-15T21:30:00Z"), 6);
  assert.equal(weekdayIndex("2026-11-15T22:30:00Z"), 0);
});
