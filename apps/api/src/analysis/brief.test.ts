import assert from "node:assert/strict";
import { test } from "node:test";
import { type Event, type Goal, GoalCategory, type Recommendation } from "@michael/shared";
import { APPS, calendar, goal, mac, phone, search, syntheticMonth, T, web } from "../patterns/testkit";
import { type BriefInput, briefJson, briefWindow, buildBrief, renderUserMessage } from "./brief";

// A synthetic week: every app, site, title, name and search term here is made up.

// The brief passes a goal's category through as data and never reads it: any two will do.
const first = GoalCategory.options[0] as Goal["category"];
const second = GoalCategory.options[1] as Goal["category"];
const GOALS: Goal[] = [
  {
    ...goal(first, "10000000-0000-4000-8000-0000000000a1", "Degree"),
    description: "Exams in December.",
    weekly_budget_minutes: 360,
    target: { calendar_titles: ["Study"] },
  },
  {
    ...goal(second, "10000000-0000-4000-8000-0000000000a2", "Race"),
    weekly_budget_minutes: 300,
    target: { calendar_titles: ["Gym"] },
  },
  // A goal that is not on the calendar at all.
  { ...goal(first, "10000000-0000-4000-8000-0000000000a3", "Reading"), weekly_budget_minutes: 120 },
];

const PRIVATE = {
  person: "Yannis Papadopoulos",
  errand: "Call Maria Example about the flat",
  host: "intranet.private.example",
  search: "a made up search",
  searchInBlock: "symptoms of something personal",
  pageTitle: "A page title that must never reach a summary",
};

// Tuesday 10 November 2026, with eight days of device data before it.
const device = syntheticMonth(8, "2026-11-03T00:00:00+02:00");
const calendarEvents: Event[] = [
  // Today: one own block (done), one meeting, one errand.
  calendar("Study: accounting", T("2026-11-10 10:00"), T("2026-11-10 12:00")),
  calendar(`Lunch with ${PRIVATE.person}`, T("2026-11-10 13:00"), T("2026-11-10 14:00"), {
    attendees: 1,
    location: "12 Example Street, Athens",
  }),
  calendar(PRIVATE.errand, T("2026-11-10 15:00"), T("2026-11-10 15:30")),
  // A block that looks like a goal block but has someone else in it.
  calendar(`Gym with ${PRIVATE.person}`, T("2026-11-10 18:00"), T("2026-11-10 19:00"), { attendees: 1 }),
  // Tomorrow: two own blocks still ahead and a meeting.
  calendar("Study: finance", T("2026-11-11 10:00"), T("2026-11-11 12:00")),
  calendar("Gym", T("2026-11-11 18:00"), T("2026-11-11 19:30")),
  calendar(`Review with ${PRIVATE.person}`, T("2026-11-11 14:00"), T("2026-11-11 15:00"), { attendees: 3 }),
  // Earlier this week and later this week.
  calendar("Gym", T("2026-11-09 18:00"), T("2026-11-09 19:00")),
  calendar("Study: revision", T("2026-11-13 09:00"), T("2026-11-13 10:00")),
];
const extras: Event[] = [
  // Distraction inside today's study block, a private site and a search right before it.
  phone(APPS.social, T("2026-11-10 10:20"), T("2026-11-10 10:31")),
  search(PRIVATE.searchInBlock, T("2026-11-10 10:40")),
  web(PRIVATE.host, T("2026-11-10 10:41"), T("2026-11-10 10:44"), "extension", {
    url: `https://${PRIVATE.host}/people/${encodeURIComponent(PRIVATE.person)}?q=1`,
  }),
];
const EVENTS = [...device, ...calendarEvents, ...extras];

const rec = (title: string, status: Recommendation["status"], created: string): Recommendation => ({
  id: crypto.randomUUID(),
  analysis_run_id: null,
  goal_id: null,
  title,
  rationale: "",
  action: null,
  status,
  executed_at: null,
  undone_at: null,
  created_at: created,
  updated_at: created,
});

const input = (over: Partial<BriefInput> = {}): BriefInput => ({
  events: EVENTS,
  goals: GOALS,
  recommendations: [
    {
      ...rec("Instagram opened 30 times before noon.", "dismissed", T("2026-11-09 21:00")),
      analysis_run_id: crypto.randomUUID(),
    },
    rec("Leave by 13:10 for the 14:00.", "proposed", T("2026-11-10 08:00")),
    rec("A recommendation from the future.", "proposed", T("2026-11-12 21:00")),
  ],
  from: T("2026-11-10 00:00"),
  to: T("2026-11-10 21:00"),
  now: T("2026-11-10 21:00"),
  trigger: "evening",
  ...over,
});

/** Reads a path in the brief, and fails loudly when a step is missing. */
function at<T>(root: unknown, ...path: (string | number)[]): T {
  let value: unknown = root;
  for (const key of path) {
    assert.ok(value !== null && typeof value === "object", `nothing at ${path.join(".")}`);
    value = (value as Record<string | number, unknown>)[key];
  }
  return value as T;
}

const built = buildBrief(input());
const text = renderUserMessage(built.brief);

test("nothing private reaches the model", () => {
  // No event ids: neither the calendar events' nor any other event's.
  for (const e of EVENTS.slice(0, 500).concat(calendarEvents, extras)) {
    assert.ok(!text.includes(e.id), `event id ${e.id} leaked`);
  }
  assert.doesNotMatch(text, /0000-4000-8000-0000000\d{5}/, "an event id leaked");
  // No names from events with other people, no errand titles, no locations.
  for (const leak of [
    "Yannis",
    "Papadopoulos",
    "Maria",
    "the flat",
    "Lunch",
    "Review with",
    "Example Street",
  ]) {
    assert.ok(!text.includes(leak), `"${leak}" leaked`);
  }
  // No full addresses, no host that is not on the public list, no search terms, no page titles.
  assert.doesNotMatch(text, /https?:\/\//);
  assert.ok(!text.includes(PRIVATE.host) && !text.includes("private.example"));
  assert.ok(!text.includes(PRIVATE.search) && !text.includes(PRIVATE.searchInBlock));
  assert.ok(!text.includes(PRIVATE.pageTitle));
  assert.doesNotMatch(text, /"(term|url|external_id|event_id|block_event_id|evidence|location)"/);
});

test("the only ids in the brief are the goals' own", () => {
  const ids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
  assert.deepEqual([...new Set(ids)].sort(), GOALS.map((g) => g.id).sort());
});

test("the head of the brief says when, where and why", () => {
  const b = built.brief as Record<string, unknown>;
  assert.equal(b.now, "2026-11-10 21:00");
  assert.equal(b.weekday, "Tuesday");
  assert.equal(b.timezone, "Europe/Athens");
  assert.equal(b.trigger, "evening");
  assert.deepEqual(b.range, { from: "2026-11-10 00:00", to: "2026-11-10 21:00" });
});

test("goals carry their budget and this week's numbers from the score", () => {
  const goals = built.brief.goals as Record<string, unknown>[];
  const { this_week: degree, ...head } = goals[0] as Record<string, unknown> & {
    this_week: Record<string, number>;
  };
  assert.deepEqual(head, {
    id: GOALS[0]?.id,
    title: "Degree",
    category: first,
    weekly_budget_minutes: 360,
    description: "Exams in December.",
  });
  // Tuesday's block is over, Wednesday's and Friday's are ahead.
  assert.equal(degree.planned_minutes, 300);
  assert.equal(degree.elapsed_minutes, 120);
  assert.equal(degree.ahead_minutes, 180);
  assert.equal((degree.spent_minutes ?? 0) + (degree.lost_minutes ?? 0), 120);
  assert.ok((degree.lost_minutes ?? 0) >= 11, "11 minutes of Instagram at least");
  assert.equal(degree.budget_not_yet_planned_minutes, 60);
  // The gym session with a friend is not the user's own block: only Monday's and Wednesday's count.
  const race = goals[1]?.this_week as Record<string, number>;
  assert.equal(race.planned_minutes, 150);
  assert.equal(race.elapsed_minutes, 60);
  assert.equal(race.ahead_minutes, 90);
  const reading = goals[2]?.this_week as Record<string, number>;
  assert.equal(reading.planned_minutes, 0);
  assert.equal(reading.budget_not_yet_planned_minutes, 120);
});

test("standing instructions are passed on as written, and the list is always there", () => {
  assert.deepEqual(built.brief.instructions, []);
  const withRules = buildBrief(
    input({ instructions: ["Keep Sundays clear.", "  Home every day by 21:00 ", ""] }),
  );
  assert.deepEqual(withRules.brief.instructions, ["Keep Sundays clear.", "Home every day by 21:00"]);
  assert.ok(renderUserMessage(withRules.brief).includes("Home every day by 21:00"));
});

test("the plan names the user's own blocks and keeps everything else anonymous", () => {
  const plan = built.brief.plan as { days: Record<string, unknown>[]; week: Record<string, unknown> };
  assert.deepEqual(
    plan.days.map((d) => d.is),
    ["today", "tomorrow"],
  );
  const [today, tomorrow] = plan.days;
  const blocks = today?.goal_blocks as Record<string, unknown>[];
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.title, "Study: accounting");
  assert.equal(blocks[0]?.goal, "Degree");
  assert.equal(blocks[0]?.state, "done");
  assert.equal(blocks[0]?.ref, undefined, "a block that is over cannot be moved");
  // Other people's events: time only. The errand: time only.
  assert.deepEqual(today?.busy_with_others, [
    { start: "13:00", end: "14:00" },
    { start: "18:00", end: "19:00" },
  ]);
  assert.deepEqual(today?.own_no_goal, [{ start: "15:00", end: "15:30" }]);
  assert.deepEqual(
    at<Record<string, unknown>[]>(tomorrow, "goal_blocks").map((b) => [
      b.ref,
      b.title,
      b.start,
      b.end,
      b.state,
    ]),
    [
      ["b1", "Study: finance", "10:00", "12:00", "ahead"],
      ["b2", "Gym", "18:00", "19:30", "ahead"],
    ],
  );
  assert.deepEqual(plan.week.from, "2026-11-09");
  assert.deepEqual(plan.week.to, "2026-11-15");
  assert.equal(plan.week.days_left_after_today, 5);
});

test("a finished block says what was spent, what was lost and to what", () => {
  const plan = built.brief.plan as { days: Record<string, unknown>[] };
  const block = at<Record<string, unknown>>(plan, "days", 0, "goal_blocks", 0);
  assert.equal((block.spent_minutes as number) + (block.lost_minutes as number), 120);
  assert.ok((block.lost_minutes as number) >= 11);
  assert.ok((block.lost_to as { app: string; minutes: number }[]).some((x) => x.app === "Instagram"));
  assert.equal(plan.days[0]?.planned_minutes, 120);
  const soFar = plan.days[0]?.so_far as Record<string, number>;
  assert.equal(soFar.elapsed_minutes, 120);
  assert.equal(soFar.lost_minutes, block.lost_minutes);
  // Tomorrow has not happened: a plan, no verdict.
  assert.equal(plan.days[1]?.planned_minutes, 210);
  assert.equal(plan.days[1]?.so_far, undefined);
});

test("the context keeps what the brief hides, for checking the answer", () => {
  const { context } = built;
  assert.deepEqual([...context.blocks.keys()], ["b1", "b2"]);
  assert.equal(context.blocks.get("b1")?.eventId, calendarEvents[4]?.id);
  assert.equal(context.blocks.get("b2")?.eventId, calendarEvents[5]?.id);
  assert.deepEqual([...context.goalIds].sort(), GOALS.map((g) => g.id).sort());
  assert.equal(context.busy.length, 3);
  assert.deepEqual(
    [...context.blockTitles],
    [
      [GOALS[0]?.id, "Study"],
      [GOALS[1]?.id, "Gym"],
    ],
  );
  assert.ok(context.patterns.has("phone_cadence"));
  assert.ok(context.patterns.has("time_by_app"));
});

test("patterns keep the headline of every detector that has data and name the silent ones", () => {
  const patterns = built.brief.patterns as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(patterns), ["last_7_days", "range"]);
  const week = patterns.last_7_days?.detectors as { name: string; summary: string; data?: unknown }[];
  assert.equal(week[0]?.name, "phone_cadence", "most important first");
  for (const d of week) assert.ok(d.summary.length > 0, `${d.name} has its sentence`);
  // One day is too little for a rhythm: the range lists that detector as silent, with the reason.
  const silent = patterns.range?.not_enough_data as Record<string, string>;
  assert.match(silent.phone_cadence ?? "", /needs at least 3 days/);
  const names = at<{ name: string }[]>(patterns, "range", "detectors").map((d) => d.name);
  assert.ok(!names.includes("phone_cadence"));
  assert.ok(names.includes("time_by_app"));
  const hours = patterns.range?.screen_minutes_by_hour as { columns: string[]; rows: unknown[][] };
  assert.deepEqual(hours.columns, ["hour", "work", "distracting", "other"]);
  assert.ok(hours.rows.length > 5);
});

test("data notes say how fresh the phone is, how blind the browser is and what is missing", () => {
  const notes = built.brief.data_notes as Record<string, Record<string, unknown>>;
  assert.equal(notes.phone?.covers_today, true);
  assert.equal(typeof notes.browser_time_unmeasured_share?.last_7_days, "number");
  // The synthetic week has sleep and recovery, a calendar, and no workouts.
  assert.deepEqual(notes.sources_with_no_data_in_the_last_7_days, ["workouts"]);

  // The phone a day behind: its last interval ends on Monday evening.
  const stale = buildBrief(
    input({
      events: EVENTS.filter((e) => e.source !== "iphone_usage" || e.start_at < "2026-11-09T18:00:00.000Z"),
    }),
  );
  const phoneNote = (stale.brief.data_notes as Record<string, Record<string, unknown>>).phone;
  assert.equal(phoneNote?.covers_today, false);
  assert.ok((phoneNote?.hours_old as number) > 20);
  assert.match(phoneNote?.newest_data as string, /^2026-11-09 /);

  // Nothing at all from the phone, no calendar, no sleep.
  const bare = buildBrief(input({ events: EVENTS.filter((e) => e.source === "macos_usage") }));
  const bareNotes = bare.brief.data_notes as Record<string, unknown>;
  assert.deepEqual(bareNotes.phone, { newest_data: null, note: "no data at all" });
  assert.deepEqual(bareNotes.sources_with_no_data_in_the_last_7_days, [
    "calendar",
    "sleep",
    "recovery",
    "workouts",
  ]);
});

test("the brief says whether actions are offers or applied, offers unless told otherwise", () => {
  assert.equal(built.brief.actions_are, "offers");
  assert.equal(built.context.actionsAre, "offers");
  const applied = buildBrief(input({ actionsAre: "applied" }));
  assert.equal(applied.brief.actions_are, "applied");
  assert.equal(applied.context.actionsAre, "applied");
});

test("questions already asked are listed, newest first, at most five, never from after now", () => {
  assert.deepEqual(built.brief.already_asked, []);
  const asked = [
    { question: "Was the 18:00 gym hour training or rest?", asked_at: T("2026-11-09 21:00") },
    { question: " Is the Friday study hour still on? ", asked_at: T("2026-11-10 08:00") },
    { question: "A question from the future?", asked_at: T("2026-11-12 08:00") },
    { question: "  ", asked_at: T("2026-11-10 09:00") },
    ...[3, 4, 5, 6, 7].map((d) => ({ question: `Older question ${d}?`, asked_at: T(`2026-11-0${d} 21:00`) })),
  ];
  const withAsked = buildBrief(input({ asked }));
  assert.deepEqual(withAsked.brief.already_asked, [
    { asked: "2026-11-10", question: "Is the Friday study hour still on?" },
    { asked: "2026-11-09", question: "Was the 18:00 gym hour training or rest?" },
    { asked: "2026-11-07", question: "Older question 7?" },
    { asked: "2026-11-06", question: "Older question 6?" },
    { asked: "2026-11-05", question: "Older question 5?" },
  ]);
});

test("recent recommendations are listed, newest first, never ones given after now", () => {
  assert.deepEqual(built.brief.already_recommended, [
    // Made by rules elsewhere (travel, for one): no analysis run behind it.
    { given: "2026-11-10", title: "Leave by 13:10 for the 14:00.", status: "proposed", made_by: "elsewhere" },
    {
      given: "2026-11-09",
      title: "Instagram opened 30 times before noon.",
      status: "dismissed",
      made_by: "you",
    },
  ]);
});

test("a morning brief adds yesterday: its blocks and its patterns", () => {
  const morning = buildBrief(
    input({
      from: T("2026-11-11 00:00"),
      to: T("2026-11-11 08:00"),
      now: T("2026-11-11 08:00"),
      trigger: "morning",
    }),
  );
  const plan = morning.brief.plan as { days: Record<string, unknown>[] };
  assert.deepEqual(
    plan.days.map((d) => [d.is, d.date]),
    [
      ["yesterday", "2026-11-10"],
      ["today", "2026-11-11"],
      ["tomorrow", "2026-11-12"],
    ],
  );
  const patterns = morning.brief.patterns as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(patterns), ["last_7_days", "range", "yesterday"]);
  assert.equal(patterns.yesterday?.from, "2026-11-10 00:00");
  assert.equal(patterns.yesterday?.to, "2026-11-10 24:00");
  // Today's blocks are all still ahead, so they can be moved.
  assert.deepEqual([...morning.context.blocks.keys()], ["b1", "b2"]);
});

test("a range that ends at midnight still belongs to the day before", () => {
  const evening = buildBrief(input({ to: T("2026-11-11 00:00"), now: T("2026-11-11 00:00") }));
  assert.equal(evening.brief.now, "2026-11-10 24:00");
  assert.equal(evening.brief.weekday, "Tuesday");
  assert.deepEqual(evening.brief.range, { from: "2026-11-10 00:00", to: "2026-11-10 24:00" });
  const plan = evening.brief.plan as { days: Record<string, unknown>[] };
  assert.deepEqual(
    plan.days.map((d) => d.date),
    ["2026-11-10", "2026-11-11"],
  );
});

test("the brief stays small and is the same text every time", () => {
  assert.equal(renderUserMessage(buildBrief(input()).brief), text);
  assert.ok(text.length < 16_000, `the brief grew to ${text.length} characters`);
  assert.deepEqual(JSON.parse(briefJson(built.brief)), JSON.parse(JSON.stringify(built.brief)));
});

test("it works with no goals, no calendar and almost no data", () => {
  const empty = buildBrief(
    input({
      events: [mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:20"))],
      goals: [],
      recommendations: [],
    }),
  );
  assert.deepEqual(empty.brief.goals, []);
  assert.equal(empty.context.blocks.size, 0);
  assert.ok(renderUserMessage(empty.brief).length > 0);
});

test("bad ranges are refused and the window covers the week and the days before", () => {
  assert.throws(
    () => buildBrief(input({ from: T("2026-11-10 21:00"), to: T("2026-11-10 09:00") })),
    RangeError,
  );
  assert.throws(() => buildBrief(input({ from: "yesterday" })), RangeError);
  assert.throws(() => buildBrief(input({ from: T("2026-09-01 00:00") })), RangeError);
  const window = briefWindow(input());
  assert.equal(window.from, new Date(T("2026-11-03 00:00")).toISOString());
  assert.equal(window.to, new Date(T("2026-11-16 00:00")).toISOString());
});

test("checklist and count goals: today's open outcomes and the count's pace reach the brief as data (#238)", () => {
  const outcomes: Goal = {
    ...goal(first, "10000000-0000-4000-8000-0000000000b1", "Outcomes"),
    target: { kind: "checklist" },
  };
  const gym: Goal = {
    ...goal(second, "10000000-0000-4000-8000-0000000000b2", "Gym three times"),
    target: { kind: "count", per_week: 3, calendar_titles: ["Gym"] },
  };
  const item = (
    id: string,
    date: string,
    text: string,
    status: "open" | "done" | "moved",
    position: number,
  ) => ({
    id,
    goal_id: outcomes.id,
    date,
    text,
    position,
    status,
    settled_at: null,
    settled_by: null,
    carried_from: status === "open" && position === 0 ? "90000000-0000-4000-8000-000000000009" : null,
    created_at: T("2026-11-10 07:00"),
    updated_at: T("2026-11-10 07:00"),
  });
  const { brief } = buildBrief(
    input({
      goals: [...GOALS, outcomes, gym],
      checklist: [
        item("90000000-0000-4000-8000-000000000001", "2026-11-10", "Send the deck", "open", 0),
        item("90000000-0000-4000-8000-000000000002", "2026-11-10", "Pay the invoice", "done", 1),
        item("90000000-0000-4000-8000-000000000003", "2026-11-09", "Yesterday's thing", "open", 0),
      ],
      // Monday's gym block (18:00 to 19:00) and a yes on Monday evening: one session.
      countCheckIns: [
        {
          goal_id: gym.id,
          event_id: null,
          start: Date.parse(T("2026-11-09 21:00")),
          end: Date.parse(T("2026-11-09 21:00")),
          untimed: true,
        },
      ],
    }),
  );
  assert.deepEqual(at(brief, "checklist_today"), [
    { goal: "Outcomes", text: "Send the deck", carried: true },
  ]);
  const goals = at<Record<string, unknown>[]>(brief, "goals");
  const row = (title: string) => goals.find((g) => g.title === title)?.this_week;
  assert.deepEqual(row("Gym three times"), {
    scored: false,
    count: { done: 1, target: 3, left: 2, days_left: 6, behind_pace: false },
  });
  assert.deepEqual(row("Outcomes"), {
    scored: false,
    checklist: { today: { set: 2, done: 1 }, week: { set: 3, done: 1 } },
  });
  // Without items the brief carries no checklist line at all.
  assert.equal(at<Record<string, unknown>>(built, "brief").checklist_today, undefined);
});
