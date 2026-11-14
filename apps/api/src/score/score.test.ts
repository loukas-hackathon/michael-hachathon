import assert from "node:assert/strict";
import { test } from "node:test";
import { type Event, type Goal, type Instruction, Score } from "@michael/shared";
import {
  APPS,
  calendar,
  goal,
  mac,
  phone,
  sleep,
  syntheticMonth,
  T,
  web,
  workout,
} from "../patterns/testkit";
import { detectRecords } from "./records";
import { buildScore, isSleepGoal, scoreRange, scoreWithHistory } from "./score";

// Small synthetic timelines whose answer can be worked out by hand. Every title, app and time
// here is made up.

const withTarget = (g: Goal, target: Record<string, unknown>, budget: number): Goal => ({
  ...g,
  target,
  weekly_budget_minutes: budget,
});

const COMPANY = withTarget(
  goal("work", "10000000-0000-4000-8000-000000000001", "The company"),
  { calendar_titles: ["Cold Outreach"] },
  480,
);
const TRI = withTarget(
  goal("gym", "10000000-0000-4000-8000-000000000002", "Triathlon"),
  { calendar_titles: ["Gym", "Run"] },
  540,
);
const SLEEP = withTarget(
  goal("rest", "10000000-0000-4000-8000-000000000003", "Sleep"),
  { sleep_hours: 7.5 },
  3150,
);
const GOALS = [COMPANY, TRI, SLEEP];

/** Score for a local day, as it stands at `now` (Athens winter time). Checked against the contract. */
const score = (events: Event[], date: string, now: string, goals: Goal[] = GOALS) =>
  Score.parse(buildScore(events, goals, { date, now: now.includes("T") ? now : T(now) }));

const seven = (s: {
  planned_minutes: number;
  elapsed_minutes: number;
  spent_minutes: number;
  lost_minutes: number;
  ahead_minutes: number;
  unverified_minutes: number;
  score_pct: number | null;
}) => [
  s.planned_minutes,
  s.elapsed_minutes,
  s.spent_minutes,
  s.lost_minutes,
  s.ahead_minutes,
  s.unverified_minutes,
  s.score_pct,
];

const ticks = (pattern: string) =>
  [...pattern].map((c) => ({ "#": "spent", x: "lost", ".": "ahead", "?": "unverified" })[c]);

// ---------- the attribution rule ----------

test("a finished work block: time lost on the phone and on the Mac is counted once", () => {
  const s = score(
    [
      calendar("Cold Outreach", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
      mac(APPS.editor, T("2026-11-10 10:00"), T("2026-11-10 11:00")),
      // Phone from 10:20 to 10:30, Mac chat from 10:25 to 10:35: they overlap for 5 minutes.
      phone(APPS.social, T("2026-11-10 10:20"), T("2026-11-10 10:30")),
      mac(APPS.chat, T("2026-11-10 10:25"), T("2026-11-10 10:35")),
    ],
    "2026-11-10",
    "2026-11-10 12:00",
  );
  // Lost 10:20 to 10:35 = 15 minutes, not 20. The editor holds the other 45.
  //                       planned elapsed spent lost ahead unverified score
  assert.deepEqual(seven(s.day), [60, 60, 45, 15, 0, 0, 75]);
  const [block] = s.day.blocks;
  assert.equal(s.day.blocks.length, 1);
  assert.equal(block?.goal_id, COMPANY.id);
  assert.equal(block?.goal_title, "The company");
  assert.equal(block?.title, "Cold Outreach");
  assert.equal(block?.matched_by, "calendar_titles");
  assert.deepEqual(block?.ticks, ticks("####xxx#####"));
  assert.deepEqual(block?.lost, [
    {
      start_at: "2026-11-10T08:20:00.000Z",
      end_at: "2026-11-10T08:35:00.000Z",
      minutes: 15,
      what: "Instagram", // 10 minutes of the 15
      kind: "app",
      category: "social",
      device: "iphone",
    },
  ]);
});

test("a block in progress counts up to now, the rest is ahead", () => {
  const events = [
    calendar("Cold Outreach", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
    mac(APPS.editor, T("2026-11-10 10:00"), T("2026-11-10 10:10")),
    mac(APPS.chat, T("2026-11-10 10:10"), T("2026-11-10 10:15")),
    mac(APPS.editor, T("2026-11-10 10:15"), T("2026-11-10 10:32")),
  ];
  const s = score(events, "2026-11-10", "2026-11-10 10:30");
  assert.deepEqual(seven(s.day), [60, 30, 25, 5, 30, 0, 83]);
  assert.deepEqual(s.day.blocks[0]?.ticks, ticks("##x###......"));
  assert.equal(s.day.now, "2026-11-10T08:30:00.000Z");

  // Two minutes later the tick that has started is no longer ahead.
  const later = score(events, "2026-11-10", "2026-11-10 10:32");
  assert.deepEqual(seven(later.day), [60, 32, 27, 5, 28, 0, 84]);
  assert.deepEqual(later.day.blocks[0]?.ticks, ticks("##x####....."));
});

test("before the first block there is no score: null, not 0 and not 100", () => {
  const s = score(
    [calendar("Cold Outreach", T("2026-11-10 10:00"), T("2026-11-10 11:00"))],
    "2026-11-10",
    "2026-11-10 09:00",
  );
  assert.deepEqual(seven(s.day), [60, 0, 0, 0, 60, 0, null]);
  assert.deepEqual(s.day.blocks[0]?.ticks, ticks("............"));
  assert.equal(s.day.blocks[0]?.score_pct, null);
  assert.equal(s.score_pct, null);
  assert.equal(s.planned_minutes, 60);
  assert.equal(s.spent_minutes, 0);
  assert.equal(s.goals.find((g) => g.goal_id === COMPANY.id)?.score_pct, null);

  // A day with no plan at all has no score either.
  const empty = score([], "2026-11-10", "2026-11-10 12:00");
  assert.deepEqual(seven(empty.day), [0, 0, 0, 0, 0, 0, null]);
  assert.deepEqual(empty.day.blocks, []);
});

test("an event with other people in it is not a block", () => {
  const s = score(
    [
      calendar("Cold Outreach", T("2026-11-10 10:00"), T("2026-11-10 11:00"), { attendees: 1 }),
      mac(APPS.chat, T("2026-11-10 10:00"), T("2026-11-10 10:30")),
    ],
    "2026-11-10",
    "2026-11-10 12:00",
  );
  assert.deepEqual(s.day.blocks, []);
  assert.equal(s.planned_minutes, 0);
  assert.equal(s.lost_minutes, 0);
});

test("verified against unverified: a workout proves training, an empty block is spent but unproven", () => {
  const gym = calendar("Gym", T("2026-11-10 18:00"), T("2026-11-10 19:00"));

  // No device data and no workout: the hour counts as spent, none of it verified.
  const bare = score([gym], "2026-11-10", "2026-11-10 20:00");
  assert.deepEqual(seven(bare.day), [60, 60, 60, 0, 0, 60, 100]);
  assert.deepEqual(bare.day.blocks[0]?.ticks, ticks("????????????"));

  // A workout from 18:10 to 18:50 with 5 minutes of Instagram inside it.
  const proven = score(
    [
      gym,
      workout(T("2026-11-10 18:10"), T("2026-11-10 18:50")),
      phone(APPS.social, T("2026-11-10 18:20"), T("2026-11-10 18:25")),
    ],
    "2026-11-10",
    "2026-11-10 20:00",
  );
  // Lost 5, spent 55, verified 40 - 5 = 35, unverified 20 (before and after the workout).
  assert.deepEqual(seven(proven.day), [60, 60, 55, 5, 0, 20, 92]);
  assert.deepEqual(proven.day.blocks[0]?.ticks, ticks("??##x#####??"));
});

test("a work block is verified by work apps only: neutral apps and no data stay unverified", () => {
  const s = score(
    [
      calendar("Cold Outreach", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
      mac(APPS.editor, T("2026-11-10 10:00"), T("2026-11-10 10:20")), // work
      mac(APPS.finder, T("2026-11-10 10:20"), T("2026-11-10 10:40")), // neutral
      // 10:40 to 11:00: nothing on any device.
      workout(T("2026-11-10 10:00"), T("2026-11-10 11:00")), // proves nothing about a work goal
    ],
    "2026-11-10",
    "2026-11-10 12:00",
  );
  assert.deepEqual(seven(s.day), [60, 60, 60, 0, 0, 40, 100]);
  assert.deepEqual(s.day.blocks[0]?.ticks, ticks("####????????"));
});

test("sleep sits outside the score but stays in the goals list with its budget", () => {
  const s = score(
    [
      calendar("Sleep", T("2026-11-10 23:00"), T("2026-11-11 07:00")),
      calendar("Wind down", T("2026-11-10 22:00"), T("2026-11-10 23:00"), { goal_id: SLEEP.id }),
      calendar("Gym", T("2026-11-10 18:00"), T("2026-11-10 19:00")),
    ],
    "2026-11-10",
    "2026-11-12 12:00",
  );
  assert.deepEqual(
    s.day.blocks.map((b) => b.title),
    ["Gym"],
  );
  assert.equal(s.planned_minutes, 60);
  const row = s.goals.find((g) => g.goal_id === SLEEP.id);
  assert.equal(row?.scored, false);
  assert.equal(row?.budget_minutes, 3150);
  assert.equal(row?.planned_minutes, 0);
  assert.equal(row?.score_pct, null);
  assert.deepEqual(
    s.goals.map((g) => [g.title, g.scored, g.budget_minutes, g.planned_minutes, g.spent_minutes]),
    [
      ["The company", true, 480, 0, 0],
      ["Triathlon", true, 540, 60, 60],
      ["Sleep", false, 3150, 0, 0],
    ],
  );

  // Only rest goals that describe sleep are left out.
  assert.equal(isSleepGoal(SLEEP), true);
  assert.equal(isSleepGoal(withTarget(goal("rest", SLEEP.id, "Evenings off"), { evenings: 3 }, 300)), false);
  assert.equal(
    isSleepGoal(withTarget(goal("work", SLEEP.id, "Sleep research"), { sleep_hours: 8 }, 300)),
    false,
  );
});

test("overlapping blocks: the earlier one keeps the time; an inactive goal has no blocks", () => {
  const events = [
    calendar("Cold Outreach", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
    calendar("Gym", T("2026-11-10 10:30"), T("2026-11-10 11:30")),
  ];
  const s = score(events, "2026-11-10", "2026-11-10 12:00");
  assert.deepEqual(
    s.day.blocks.map((b) => [b.title, b.start_at.slice(11, 16), b.end_at.slice(11, 16), b.planned_minutes]),
    [
      ["Cold Outreach", "08:00", "09:00", 60],
      ["Gym", "09:00", "09:30", 30],
    ],
  );
  assert.equal(s.day.planned_minutes, 90);

  const off = score(events, "2026-11-10", "2026-11-10 12:00", [COMPANY, { ...TRI, active: false }]);
  assert.equal(off.day.planned_minutes, 60);
  assert.deepEqual(
    off.goals.map((g) => g.title),
    ["The company"],
  );
});

test("a lost stretch names an app or a site category, never an address or a page title", () => {
  const s = score(
    [
      calendar("Cold Outreach", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
      mac(APPS.browser, T("2026-11-10 10:00"), T("2026-11-10 11:00")),
      web("cheap-flights.example", T("2026-11-10 10:10"), T("2026-11-10 10:20"), "extension", {
        category: "travel",
      }),
      web("youtube.com", T("2026-11-10 10:30"), T("2026-11-10 10:36"), "extension"),
    ],
    "2026-11-10",
    "2026-11-10 12:00",
  );
  assert.deepEqual(
    s.day.blocks[0]?.lost.map((l) => [l.what, l.kind, l.category, l.minutes]),
    [
      ["a travel site", "site", "travel", 10],
      ["youtube.com", "site", "video", 6],
    ],
  );
  assert.equal(s.day.lost_minutes, 16);
  const body = JSON.stringify(s);
  assert.equal(body.includes("cheap-flights.example"), false);
  assert.equal(body.includes("page title"), false);
});

// ---------- kinds, the three categories and standing instructions ----------

const BUSINESS = withTarget(
  goal("business", "10000000-0000-4000-8000-000000000011", "The company"),
  { calendar_titles: ["Cold Outreach"] },
  480,
);
const STUDY = withTarget(
  goal("work", "10000000-0000-4000-8000-000000000012", "University"), // an older category name
  { calendar_titles: ["Study"] },
  360,
);
const TRAINING = withTarget(
  goal("health", "10000000-0000-4000-8000-000000000013", "Triathlon"),
  { kind: "time", calendar_titles: ["Gym", "Run"] },
  540,
);
const FUN = withTarget(
  goal("personal", "10000000-0000-4000-8000-000000000014", "Fun"),
  { kind: "time", label: "fun", calendar_titles: ["Night out"] },
  120,
);

test("only goals of kind time are scored: a target, a count and a checklist are listed, with no blocks", () => {
  const sleep = withTarget(
    goal("health", "10000000-0000-4000-8000-000000000021", "Sleep"),
    { kind: "target", sleep_hours: 7.5, screens_off: "23:00" },
    0,
  );
  const yoga = withTarget(
    goal("health", "10000000-0000-4000-8000-000000000022", "Yoga"),
    { kind: "count", per_week: 2, calendar_titles: ["Yoga"] },
    0,
  );
  const outcomes = withTarget(
    goal("business", "10000000-0000-4000-8000-000000000023", "Today's outcomes"),
    { kind: "checklist" },
    0,
  );
  const s = score(
    [
      calendar("Cold Outreach", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
      // Each of these names a goal that is not measured in minutes: none becomes a block.
      calendar("Yoga", T("2026-11-10 07:00"), T("2026-11-10 08:00")),
      calendar("Sleep", T("2026-11-10 23:00"), T("2026-11-11 07:00")),
      calendar("Today's outcomes", T("2026-11-10 09:00"), T("2026-11-10 09:30")),
      calendar("Plan the day", T("2026-11-10 08:30"), T("2026-11-10 09:00"), { goal_id: outcomes.id }),
      phone(APPS.social, T("2026-11-10 07:10"), T("2026-11-10 07:20")),
    ],
    "2026-11-10",
    "2026-11-12 12:00",
    [BUSINESS, sleep, yoga, outcomes],
  );
  assert.deepEqual(
    s.day.blocks.map((b) => b.title),
    ["Cold Outreach"],
  );
  assert.deepEqual(
    s.goals.map((g) => [g.title, g.area, g.kind, g.scored, g.planned_minutes, g.lost_minutes, g.score_pct]),
    [
      ["The company", "business", "time", true, 60, 0, 100],
      ["Sleep", "health", "target", false, 0, 0, null],
      ["Yoga", "health", "count", false, 0, 0, null],
      ["Today's outcomes", "business", "checklist", false, 0, 0, null],
    ],
  );
  // The phone during yoga is not lost goal time: yoga has no planned minutes in this score.
  assert.deepEqual(seven(s), [60, 60, 60, 0, 0, 60, 100]);
  // An older sleep goal (category `rest`, no kind) reads the same way.
  const old = score([], "2026-11-10", "2026-11-12 12:00", [SLEEP]);
  assert.deepEqual(
    old.goals.map((g) => [g.area, g.kind, g.scored]),
    [["health", "target", false]],
  );
});

test("areas: the same totals per category, and they add up to the week and to the day", () => {
  const events = [
    // Tuesday, the day asked for.
    calendar("Cold Outreach", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
    mac(APPS.editor, T("2026-11-10 10:00"), T("2026-11-10 11:00")),
    phone(APPS.social, T("2026-11-10 10:20"), T("2026-11-10 10:35")),
    calendar("Study", T("2026-11-10 14:00"), T("2026-11-10 15:00")),
    mac(APPS.chat, T("2026-11-10 14:00"), T("2026-11-10 14:10")),
    calendar("Gym", T("2026-11-10 18:00"), T("2026-11-10 19:00")),
    phone(APPS.social, T("2026-11-10 18:30"), T("2026-11-10 18:36")),
    calendar("Night out", T("2026-11-10 21:00"), T("2026-11-10 23:00")),
    // Wednesday: one block in progress at `now`, one ahead.
    calendar("Run", T("2026-11-11 08:00"), T("2026-11-11 09:00")),
    calendar("Cold Outreach", T("2026-11-11 10:00"), T("2026-11-11 12:00")),
  ];
  const goals = [BUSINESS, STUDY, TRAINING, FUN, SLEEP];
  const s = score(events, "2026-11-10", "2026-11-11 08:30", goals);

  const row = (a: (typeof s.day.areas)[number]) => [a.area, ...seven(a)];
  //                       planned elapsed spent lost ahead unverified score
  assert.deepEqual(s.day.areas.map(row), [
    ["business", 120, 120, 95, 25, 0, 50, 79], // 45 of the editor verified; the study hour is not
    ["health", 60, 60, 54, 6, 0, 54, 90],
    ["personal", 120, 120, 120, 0, 0, 120, 100],
  ]);
  assert.deepEqual(s.areas.map(row), [
    ["business", 240, 120, 95, 25, 120, 50, 79],
    ["health", 120, 90, 84, 6, 30, 84, 93],
    ["personal", 120, 120, 120, 0, 0, 120, 100],
  ]);
  // The older `work` goal sits under business, the older sleep goal under health, scored or not.
  assert.deepEqual(
    s.areas.map((a) => a.goal_ids),
    [[BUSINESS.id, STUDY.id], [TRAINING.id, SLEEP.id], [FUN.id]],
  );
  assert.deepEqual(
    s.day.areas.map((a) => a.goal_ids),
    s.areas.map((a) => a.goal_ids),
  );

  const fields = [
    "planned_minutes",
    "elapsed_minutes",
    "spent_minutes",
    "lost_minutes",
    "ahead_minutes",
    "unverified_minutes",
  ] as const;
  for (const f of fields) {
    assert.equal(
      s.areas.reduce((t, a) => t + a[f], 0),
      s[f],
      `week ${f}`,
    );
    assert.equal(
      s.day.areas.reduce((t, a) => t + a[f], 0),
      s.day[f],
      `day ${f}`,
    );
  }
  assert.deepEqual(seven(s.day), [300, 300, 269, 31, 0, 224, 90]);

  // A category with nothing elapsed has no score: null, not 0 and not 100. No goals: three empty rows.
  const early = score(events, "2026-11-10", "2026-11-10 09:00", goals);
  assert.deepEqual(
    early.areas.map((a) => [a.area, a.planned_minutes, a.score_pct]),
    [
      ["business", 240, null],
      ["health", 120, null],
      ["personal", 120, null],
    ],
  );
  assert.deepEqual(
    score(events, "2026-11-10", "2026-11-11 08:30", []).areas.map((a) => [a.area, a.goal_ids, ...seven(a)]),
    [
      ["business", [], 0, 0, 0, 0, 0, 0, null],
      ["health", [], 0, 0, 0, 0, 0, 0, null],
      ["personal", [], 0, 0, 0, 0, 0, 0, null],
    ],
  );
});

test("instructions_broken: a block says which standing instructions its time falls under", () => {
  const rule = (n: number, i: Partial<Instruction> & Pick<Instruction, "kind" | "text">): Instruction => ({
    id: `50000000-0000-4000-8000-00000000000${n}`,
    active: true,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...i,
  });
  const sundays = rule(1, { text: "Keep Sundays clear", kind: "clear_day", days: [0] });
  const home = rule(2, { text: "Home every day by 21:00", kind: "home_by", time: "21:00" });
  const paused = rule(3, { text: "No Saturdays", kind: "clear_day", days: [6], active: false });
  const custom = rule(4, { text: "Never two calls back to back", kind: "custom" });
  const instructions = [sundays, home, paused, custom];

  const events = [
    calendar("Cold Outreach", T("2026-11-14 10:00"), T("2026-11-14 11:00")), // Saturday morning
    calendar("Night out", T("2026-11-14 20:00"), T("2026-11-14 22:00")), // past 21:00
    calendar("Run", T("2026-11-14 23:30"), T("2026-11-15 00:30")), // into Sunday
    calendar("Gym", T("2026-11-15 10:00"), T("2026-11-15 11:00")), // a clear Sunday
    calendar("Study", T("2026-11-15 21:30"), T("2026-11-15 22:30")), // Sunday and past 21:00
  ];
  const goals = [BUSINESS, STUDY, TRAINING, FUN];
  const on = (date: string) =>
    Score.parse(buildScore(events, goals, { date, now: T("2026-11-16 12:00"), instructions })).day.blocks.map(
      (b) => [b.title, b.instructions_broken],
    );

  assert.deepEqual(on("2026-11-14"), [
    ["Cold Outreach", []],
    ["Night out", [home.id]],
    ["Run", [home.id]], // Saturday's half of the run: after 21:00, not yet Sunday
  ]);
  assert.deepEqual(on("2026-11-15"), [
    // Sunday's half: a clear Sunday, and 00:30 is still Saturday night for "home by 21:00".
    ["Run", [sundays.id, home.id]],
    ["Gym", [sundays.id]],
    ["Study", [sundays.id, home.id]],
  ]);

  // A title named in an instruction's exceptions does not break it ("Gym 45" starts with "Gym");
  // other instructions still apply to it.
  const withGym = [{ ...sundays, exceptions: ["gym"] }, home];
  const exceptionDay = Score.parse(
    buildScore([...events, calendar("Gym 45", T("2026-11-15 21:00"), T("2026-11-15 21:45"))], goals, {
      date: "2026-11-15",
      now: T("2026-11-16 12:00"),
      instructions: withGym,
    }),
  ).day.blocks.map((b) => [b.title, b.instructions_broken]);
  assert.deepEqual(exceptionDay, [
    ["Run", [sundays.id, home.id]],
    ["Gym", []],
    ["Gym 45", [home.id]],
    ["Study", [sundays.id, home.id]],
  ]);

  // The flag never changes a minute: with and without instructions the numbers are the same.
  const withRules = Score.parse(
    buildScore(events, goals, { date: "2026-11-15", now: T("2026-11-16 12:00"), instructions }),
  );
  const without = score(events, "2026-11-15", "2026-11-16 12:00", goals);
  assert.deepEqual(seven(withRules), seven(without));
  assert.deepEqual(seven(withRules.day), seven(without.day));
  assert.deepEqual(
    without.day.blocks.map((b) => b.instructions_broken),
    [[], [], []],
  );
});

// ---------- days, weeks and the clock change ----------

test("a block that crosses midnight is cut there: each day gets its part", () => {
  const run = calendar("Run", T("2026-11-10 23:30"), T("2026-11-11 00:30"));
  const events = [run, phone(APPS.social, T("2026-11-10 23:50"), T("2026-11-11 00:10"))];
  const tuesday = score(events, "2026-11-10", "2026-11-11 12:00");
  const wednesday = score(events, "2026-11-11", "2026-11-11 12:00");

  assert.deepEqual(seven(tuesday.day), [30, 30, 20, 10, 0, 20, 67]);
  assert.deepEqual(seven(wednesday.day), [30, 30, 20, 10, 0, 20, 67]);
  const [late] = tuesday.day.blocks;
  const [early] = wednesday.day.blocks;
  assert.deepEqual([late?.start_at, late?.end_at], ["2026-11-10T21:30:00.000Z", "2026-11-10T22:00:00.000Z"]);
  assert.deepEqual(
    [early?.start_at, early?.end_at],
    ["2026-11-10T22:00:00.000Z", "2026-11-10T22:30:00.000Z"],
  );
  assert.equal(late?.event_id, run.id);
  assert.equal(early?.event_id, run.id);
  assert.deepEqual(late?.ticks, ticks("????xx"));
  assert.deepEqual(early?.ticks, ticks("xx????"));
  // The week holds both parts once.
  assert.equal(tuesday.planned_minutes, 60);
  assert.equal(tuesday.lost_minutes, 20);
});

test("weeks start on Monday at local midnight", () => {
  const events = [
    // Sunday 23:00 to Monday 01:00: one hour in each week.
    calendar("Run", T("2026-11-08 23:00"), T("2026-11-09 01:00")),
    calendar("Gym", T("2026-11-09 18:00"), T("2026-11-09 19:00")),
    calendar("Gym", T("2026-11-15 18:00"), T("2026-11-15 19:00")), // the Sunday that ends the week
    calendar("Gym", T("2026-11-16 18:00"), T("2026-11-16 19:00")), // next Monday: not this week
  ];
  const monday = score(events, "2026-11-09", "2026-11-20 12:00");
  assert.equal(monday.week_start, "2026-11-08T22:00:00.000Z"); // Monday 00:00 in Athens
  assert.deepEqual(
    monday.days.map((d) => d.date),
    ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"],
  );
  assert.deepEqual(
    monday.days.map((d) => d.planned_minutes),
    [120, 0, 0, 0, 0, 0, 60],
  );
  assert.equal(monday.planned_minutes, 180);

  // Any day of the week gives the same week.
  const sunday = score(events, "2026-11-15", "2026-11-20 12:00");
  assert.equal(sunday.week_start, monday.week_start);
  assert.equal(sunday.planned_minutes, 180);
  assert.equal(sunday.day.planned_minutes, 60);

  // The Sunday before belongs to the week before, with its own hour of the run.
  const before = score(events, "2026-11-08", "2026-11-20 12:00");
  assert.equal(before.week_start, "2026-11-01T22:00:00.000Z");
  assert.equal(before.days[6]?.date, "2026-11-08");
  assert.equal(before.planned_minutes, 60);
});

test("the clock change day: 25 hours long, blocks keep their real length", () => {
  // Athens leaves summer time on Sunday 25 October 2026: 04:00 becomes 03:00.
  const events = [
    // Saturday 23:00 to Sunday 01:00, both in summer time: cut at local midnight (21:00 UTC).
    calendar("Gym", "2026-10-24T23:00:00+03:00", "2026-10-25T01:00:00+03:00"),
    // 02:30 summer time to 03:30 winter time: one hour on the wall clock, two real hours.
    calendar("Run", "2026-10-25T02:30:00+03:00", "2026-10-25T03:30:00+02:00"),
    // Monday after the change, winter time.
    calendar("Gym", "2026-10-26T00:30:00+02:00", "2026-10-26T01:30:00+02:00"),
  ];
  const sunday = score(events, "2026-10-25", "2026-10-27T12:00:00+02:00");
  assert.equal(sunday.week_start, "2026-10-18T21:00:00.000Z"); // Monday 19 October, 00:00 at +03:00
  assert.deepEqual(
    sunday.days.map((d) => d.planned_minutes),
    [0, 0, 0, 0, 0, 60, 180],
  );
  assert.deepEqual(
    sunday.day.blocks.map((b) => [b.title, b.start_at, b.end_at, b.planned_minutes, b.ticks.length]),
    [
      ["Gym", "2026-10-24T21:00:00.000Z", "2026-10-24T22:00:00.000Z", 60, 12],
      ["Run", "2026-10-24T23:30:00.000Z", "2026-10-25T01:30:00.000Z", 120, 24],
    ],
  );

  // The next week starts 7 days and one hour later, at winter midnight.
  const monday = score(events, "2026-10-26", "2026-10-27T12:00:00+02:00");
  assert.equal(monday.week_start, "2026-10-25T22:00:00.000Z");
  assert.equal(Date.parse(monday.week_start) - Date.parse(sunday.week_start), (7 * 24 + 1) * 3600_000);
  assert.equal(monday.planned_minutes, 60);

  // The range a score needs: 28 days before Monday to the end of the week.
  const range = scoreRange("2026-10-26");
  assert.equal(new Date(range.from).toISOString(), "2026-09-27T21:00:00.000Z");
  assert.equal(new Date(range.to).toISOString(), "2026-11-01T22:00:00.000Z");
});

// ---------- time won back ----------

/** One hour of outreach at 10:00 with `lost` minutes of Instagram at its start. */
const outreachDay = (day: string, lost: number): Event[] => [
  calendar("Cold Outreach", T(`${day} 10:00`), T(`${day} 11:00`)),
  ...(lost > 0
    ? [phone(APPS.social, T(`${day} 10:00`), T(`${day} 10:${String(lost).padStart(2, "0")}`))]
    : []),
];

test("time won back: less lost than on the usual day, and the week is the sum of its days", () => {
  const events = [
    ...outreachDay("2026-11-09", 15),
    ...outreachDay("2026-11-10", 15),
    ...outreachDay("2026-11-11", 15),
    ...outreachDay("2026-11-12", 5),
    ...outreachDay("2026-11-13", 30),
  ];
  // Thursday: the usual rate is 45 lost of 180 = 25%. 25% of 60 is 15; 5 were lost; 10 won back.
  const thursday = score(events, "2026-11-12", "2026-11-12 23:00");
  assert.deepEqual(thursday.day.time_won_back, {
    minutes: 10,
    usual_loss_rate: 0.25,
    history_days: 3,
    reason: null,
  });
  assert.equal(thursday.day.time_won_back_minutes, 10);
  assert.deepEqual(
    thursday.days.map((d) => d.time_won_back_minutes),
    [0, 0, 0, 10, 0, 0, 0],
  );
  assert.equal(thursday.time_won_back_minutes, 10);

  // Mid block it follows the elapsed time: at 10:40, 25% of 40 is 10; 5 were lost; 5 won back.
  const during = score(events, "2026-11-12", "2026-11-12 10:40");
  assert.equal(during.day.time_won_back_minutes, 5);

  // Friday is worse than usual (50 lost of 240 = 20.8%, 30 lost today): nothing won back, no reason.
  const friday = score(events, "2026-11-13", "2026-11-13 23:00");
  assert.deepEqual(friday.day.time_won_back, {
    minutes: 0,
    usual_loss_rate: 0.208,
    history_days: 4,
    reason: null,
  });
  assert.equal(friday.time_won_back_minutes, 10); // Thursday's 10 stays in the week
});

test("time won back: 0 with a reason until 3 of the previous 28 days had goal blocks", () => {
  const events = [
    ...outreachDay("2026-10-14", 30), // 28 days before Wednesday 11 November, 29 before Thursday
    ...outreachDay("2026-11-09", 15),
    ...outreachDay("2026-11-10", 15),
    ...outreachDay("2026-11-11", 0),
    ...outreachDay("2026-11-12", 0),
  ];
  const monday = score(events, "2026-11-09", "2026-11-13 12:00");
  assert.deepEqual(monday.day.time_won_back, {
    minutes: 0,
    usual_loss_rate: null,
    history_days: 1,
    reason: "not enough history: needs 3 days with goal blocks in the previous 28, found 1",
  });

  // Wednesday still sees 14 October: 3 days, 60 lost of 180, so 20 of today's 60 minutes won back.
  const wednesday = score(events, "2026-11-11", "2026-11-13 12:00");
  assert.deepEqual(wednesday.day.time_won_back, {
    minutes: 20,
    usual_loss_rate: 0.333,
    history_days: 3,
    reason: null,
  });

  // Thursday no longer does: Monday, Tuesday and Wednesday are the history, 30 lost of 180.
  const thursday = score(events, "2026-11-12", "2026-11-13 12:00");
  assert.deepEqual(thursday.day.time_won_back, {
    minutes: 10,
    usual_loss_rate: 0.167,
    history_days: 3,
    reason: null,
  });
  assert.equal(thursday.time_won_back_minutes, 30);
});

// ---------- ticks and totals ----------

test("ticks add up to the block: one per 5 minutes, a shorter last one when needed", () => {
  const s = score(
    [
      calendar("Cold Outreach", T("2026-11-10 09:00"), T("2026-11-10 09:45")),
      calendar("Gym", T("2026-11-10 12:00"), T("2026-11-10 12:12")),
      calendar("Run", T("2026-11-10 18:00"), T("2026-11-10 19:00")),
      // 3 of the 5 minutes of one tick lost: the tick is lost. 2 of 5: it is not.
      phone(APPS.social, T("2026-11-10 09:00"), T("2026-11-10 09:03")),
      phone(APPS.social, T("2026-11-10 09:10"), T("2026-11-10 09:12")),
    ],
    "2026-11-10",
    "2026-11-10 18:30",
  );
  assert.deepEqual(
    s.day.blocks.map((b) => [b.planned_minutes, b.ticks.length]),
    [
      [45, 9],
      [12, 3],
      [60, 12],
    ],
  );
  assert.deepEqual(s.day.blocks[0]?.ticks, ticks("x????????"));
  assert.deepEqual(s.day.blocks[2]?.ticks, ticks("??????......"));
  for (const b of s.day.blocks) {
    const past = b.ticks.filter((t) => t !== "ahead").length;
    assert.equal(past, Math.ceil(b.elapsed_minutes / 5));
    assert.equal(b.ticks.length - past, Math.floor(b.ahead_minutes / 5));
  }
  assert.deepEqual(seven(s.day), [117, 87, 82, 5, 30, 82, 94]);
});

test("every total is the sum of its parts, on a busy synthetic month", () => {
  const first = Date.parse("2026-10-12T00:00:00+03:00");
  const at = (ms: number) => new Date(ms).toISOString();
  const events = syntheticMonth(35, "2026-10-12T00:00:00+03:00");
  for (let d = 0; d < 35; d++) {
    const day = first + d * 86_400_000;
    events.push(calendar("Cold Outreach", at(day + 9 * 3600_000), at(day + 10.5 * 3600_000)));
    events.push(calendar("Gym", at(day + 20 * 3600_000), at(day + 21 * 3600_000)));
    if (d % 2 === 0) events.push(workout(at(day + 20.25 * 3600_000), at(day + 20.75 * 3600_000)));
  }
  const s = score(events, "2026-11-12", "2026-11-12T08:47:10+02:00");
  const sum = <T>(list: T[], pick: (item: T) => number) => list.reduce((t, x) => t + pick(x), 0);
  const fields = [
    "planned_minutes",
    "elapsed_minutes",
    "spent_minutes",
    "lost_minutes",
    "ahead_minutes",
    "unverified_minutes",
  ] as const;

  for (const f of fields) {
    assert.equal(
      s[f],
      sum(s.days, (d) => d[f]),
      `week ${f} = sum of days`,
    );
    assert.equal(
      s[f],
      sum(s.goals, (g) => g[f]),
      `week ${f} = sum of goals`,
    );
    assert.equal(
      s.day[f],
      sum(s.day.blocks, (b) => b[f]),
      `day ${f} = sum of blocks`,
    );
    assert.equal(
      s[f],
      sum(s.areas, (a) => a[f]),
      `week ${f} = sum of areas`,
    );
    assert.equal(
      s.day[f],
      sum(s.day.areas, (a) => a[f]),
      `day ${f} = sum of areas`,
    );
  }
  for (const part of [s, s.day, ...s.days, ...s.goals, ...s.day.blocks, ...s.areas, ...s.day.areas]) {
    assert.equal(part.spent_minutes + part.lost_minutes, part.elapsed_minutes);
    assert.equal(part.elapsed_minutes + part.ahead_minutes, part.planned_minutes);
    assert.ok(part.unverified_minutes <= part.spent_minutes);
  }
  for (const g of s.goals) {
    assert.equal(
      g.planned_minutes,
      sum(g.daily, (d) => d.planned_minutes),
    );
    assert.equal(
      g.spent_minutes,
      sum(g.daily, (d) => d.spent_minutes),
    );
  }
  assert.equal(
    s.time_won_back_minutes,
    sum(s.days, (d) => d.time_won_back_minutes),
  );
  assert.equal(s.day.time_won_back.history_days, 28);
  // Thursday at 08:47: the morning block is in progress, the evening one is ahead.
  assert.deepEqual(
    s.day.blocks.map((b) => [b.title, b.elapsed_minutes > 0, b.ahead_minutes > 0]),
    [
      ["Cold Outreach", true, true],
      ["Gym", false, true],
    ],
  );
  assert.ok(s.lost_minutes > 0);
  assert.ok(s.score_pct !== null && s.score_pct > 0 && s.score_pct < 100);
  assert.ok(s.data_until.mac !== null && s.data_until.iphone !== null);
});

// ---------- the week around the score (#117, #165, #166) ----------

test("minutes left and open blocks per goal: budget minus spent, blocks that have not ended", () => {
  const events = [
    calendar("Cold Outreach", T("2026-11-09 10:00"), T("2026-11-09 11:00")),
    // In progress at noon: 60 minutes spent so far, still open.
    calendar("Cold Outreach", T("2026-11-11 11:00"), T("2026-11-11 13:00")),
    calendar("Cold Outreach", T("2026-11-12 10:00"), T("2026-11-12 11:00")),
    calendar("Run", T("2026-11-10 08:00"), T("2026-11-10 09:00")),
    // Crosses midnight: two parts, one block.
    calendar("Gym", T("2026-11-12 23:00"), T("2026-11-13 01:00")),
  ];
  const s = score(events, "2026-11-11", "2026-11-11 12:00");
  const row = (id: string) => s.goals.find((g) => g.goal_id === id);
  assert.deepEqual(
    [row(COMPANY.id)?.spent_minutes, row(COMPANY.id)?.minutes_left, row(COMPANY.id)?.open_blocks],
    [120, 360, 2],
  );
  assert.deepEqual(
    [row(TRI.id)?.spent_minutes, row(TRI.id)?.minutes_left, row(TRI.id)?.open_blocks],
    [60, 480, 1],
  );
  // Sleep is outside the score: nothing left to count, no blocks.
  assert.deepEqual([row(SLEEP.id)?.minutes_left, row(SLEEP.id)?.open_blocks], [0, 0]);
  // Spent past the budget: never below 0.
  const small = score(events, "2026-11-11", "2026-11-11 12:00", [{ ...COMPANY, weekly_budget_minutes: 90 }]);
  assert.equal(small.goals[0]?.minutes_left, 0);
  // At the end of the week nothing is open.
  const done = score(events, "2026-11-15", "2026-11-16 00:00");
  assert.deepEqual(
    done.goals.map((g) => g.open_blocks),
    [0, 0, 0],
  );
});

test("free minutes left: the waking day from now to Sunday, minus fixed commitments", () => {
  const events = [
    // With other people: busy.
    calendar("Board call", T("2026-11-14 14:00"), T("2026-11-14 15:00"), { attendees: 3 }),
    // The user's own entry with no goal: also fixed.
    calendar("Dentist", T("2026-11-15 10:00"), T("2026-11-15 11:00")),
    // A goal block is where goal time goes: it stays free.
    calendar("Cold Outreach", T("2026-11-15 16:00"), T("2026-11-15 17:00")),
    // All day markers and anything while asleep take nothing.
    calendar("Name day", T("2026-11-15 00:00"), T("2026-11-16 00:00"), { all_day: true }),
    calendar("Late call", T("2026-11-14 23:15"), T("2026-11-14 23:45"), { attendees: 1 }),
  ];
  // The sleep goal is 7.5 hours from 23:00: the waking day is 06:30 to 23:00.
  // Saturday 12:00 to 23:00 (660) + Sunday 06:30 to 23:00 (990) - 60 - 60.
  const s = score(events, "2026-11-14", "2026-11-14 12:00");
  assert.equal(s.free_minutes_left, 660 + 990 - 120);
  // Screens off at 22:30 and 8 hours: 06:30 to 22:30 on Sunday, 12:00 to 22:30 on Saturday.
  const early = withTarget(SLEEP, { sleep_hours: 8, screens_off: "22:30" }, 3360);
  assert.equal(
    score(events, "2026-11-14", "2026-11-14 12:00", [COMPANY, early]).free_minutes_left,
    630 + 960 - 120,
  );
  // A week that has ended has none left; a week to come has all of it.
  assert.equal(score(events, "2026-11-02", "2026-11-14 12:00").free_minutes_left, 0);
  assert.equal(score([], "2026-11-23", "2026-11-14 12:00").free_minutes_left, 7 * 990);
});

test("sleep: minutes per night against the goal, null until there is data", () => {
  const nights = [
    sleep(T("2026-11-08 23:30"), T("2026-11-09 07:00")),
    sleep(T("2026-11-10 00:00"), T("2026-11-10 06:00")),
  ];
  const s = score(nights, "2026-11-11", "2026-11-11 12:00");
  assert.deepEqual(s.sleep, { goal_minutes: 450, nightly: [450, 360, null, null, null, null, null] });
  assert.equal(score([], "2026-11-11", "2026-11-11 12:00").sleep, null);
  assert.equal(score(nights, "2026-11-11", "2026-11-11 12:00", [COMPANY]).sleep, null);
});

test("history: the weeks before and the longest verified run in each ended block", () => {
  const events = [
    // 10:00 to 11:30 with the phone from 10:30 to 10:40: 30 minutes, 2 lost ticks, then 50 minutes.
    calendar("Cold Outreach", T("2026-11-03 10:00"), T("2026-11-03 11:30")),
    mac(APPS.editor, T("2026-11-03 10:00"), T("2026-11-03 11:30")),
    phone(APPS.social, T("2026-11-03 10:30"), T("2026-11-03 10:40")),
    // Not ended yet: no run.
    calendar("Cold Outreach", T("2026-11-11 11:00"), T("2026-11-11 13:00")),
  ];
  const { history } = scoreWithHistory(events, GOALS, { date: "2026-11-11", now: T("2026-11-11 12:00") });
  assert.deepEqual(
    history.weeks.map((w) => [w.week_start, w.complete, w.score_pct]),
    [
      ["2026-10-12", true, null],
      ["2026-10-19", true, null],
      ["2026-10-26", true, null],
      ["2026-11-02", true, 89],
      ["2026-11-09", false, 100],
    ],
  );
  assert.deepEqual(history.weeks[3]?.areas.business, { score_pct: 89, elapsed_minutes: 90 });
  assert.deepEqual(
    history.runs.map((r) => [r.day, r.minutes, r.first_tick, r.tick_minutes.length, r.area]),
    [["2026-11-03", 50, 8, 10, "business"]],
  );
});

test("the longest block counts verified ticks only: 120 unseen minutes do not beat 50 proven ones", () => {
  const events = [
    // Two hours with no device data at all: spent, but all of it unverified.
    calendar("Gym", T("2026-11-03 18:00"), T("2026-11-03 20:00")),
    // 50 minutes in the editor inside a sales block: verified.
    calendar("Cold Outreach", T("2026-11-04 10:00"), T("2026-11-04 10:50")),
    mac(APPS.editor, T("2026-11-04 10:00"), T("2026-11-04 10:50")),
    // Verified, then 20 minutes with no data, then verified again: the gap breaks the run.
    calendar("Cold Outreach", T("2026-11-05 10:00"), T("2026-11-05 11:00")),
    mac(APPS.editor, T("2026-11-05 10:00"), T("2026-11-05 10:20")),
    mac(APPS.editor, T("2026-11-05 10:40"), T("2026-11-05 11:00")),
  ];
  const { history } = scoreWithHistory(events, GOALS, { date: "2026-11-11", now: T("2026-11-11 12:00") });
  assert.deepEqual(
    history.runs.map((r) => [r.day, r.minutes, r.first_tick]),
    [
      ["2026-11-04", 50, 0],
      ["2026-11-05", 20, 0],
    ],
  );
  const [baseline] = detectRecords({ weeks: [], runs: history.runs, stored: [] });
  assert.deepEqual(
    [baseline?.type, baseline?.value, baseline?.achieved_on],
    ["longest_block", 50, "2026-11-04"],
  );
});
