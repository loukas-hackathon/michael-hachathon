import assert from "node:assert/strict";
import { test } from "node:test";
import { type Event, type Goal, Moment } from "@michael/shared";
import { APPS, calendar, goal, mac, sleep, T } from "../patterns/testkit";
import { computeMoment, freeSlot, momentRange, slotLength, templateHeadline } from "./compute";
import { acceptable, factsFor } from "./phrase";

// A made up week in Athens winter time. Wednesday 11 November 2026; the week began Monday 9th.
const W = "10000000-0000-4000-8000-00000000000a";
const G = "10000000-0000-4000-8000-00000000000b";
const R = "10000000-0000-4000-8000-00000000000c";
const goals: Goal[] = [
  { ...goal("work", W, "Deep work"), weekly_budget_minutes: 600 },
  { ...goal("gym", G, "Gym"), weekly_budget_minutes: 240 },
  { ...goal("rest", R, "Sleep"), weekly_budget_minutes: 3150 },
];

const workout = (start: string, end: string): Event => ({
  id: "30000000-0000-4000-8000-000000000001",
  source: "health_auto_export",
  type: "workout",
  start_at: start,
  end_at: end,
  title: "Run",
  data: {},
  external_id: null,
  created_at: "2026-01-01T00:00:00Z",
});

/** Monday and Tuesday: a two hour work block with 20 minutes of Instagram at 10:30. */
const history = (): Event[] =>
  ["2026-11-09", "2026-11-10"].flatMap((d) => [
    calendar("Deep work", T(`${d} 10:00`), T(`${d} 12:00`)),
    mac(APPS.editor, T(`${d} 10:00`), T(`${d} 10:30`)),
    mac(APPS.social, T(`${d} 10:30`), T(`${d} 10:50`)),
    mac(APPS.editor, T(`${d} 10:50`), T(`${d} 12:00`)),
  ]);

const todayPlan = (): Event[] => [
  calendar("Deep work: pitch", T("2026-11-11 10:00"), T("2026-11-11 12:00")),
  calendar("Team sync", T("2026-11-11 13:00"), T("2026-11-11 14:00"), { attendees: 4 }),
  workout(T("2026-11-09 18:00"), T("2026-11-09 19:00")),
  sleep(T("2026-11-10 23:00"), T("2026-11-11 07:00")),
];

test("momentRange covers the history days and tomorrow", () => {
  const r = momentRange(T("2026-11-11 07:30"));
  assert.equal(r.from, "2026-11-03T10:00:00.000Z"); // 4 Nov 00:00 Athens less 12 hours
  assert.equal(r.to, "2026-11-12T22:00:00.000Z"); // 13 Nov 00:00 Athens
});

test("freeSlot and slotLength", () => {
  const at = (h: number) => h * 3600_000;
  const busy = [
    { start: at(10), end: at(12) },
    { start: at(13), end: at(14) },
  ];
  assert.deepEqual(freeSlot(busy, at(8), at(21), 60), { start: at(8), end: at(9) });
  assert.deepEqual(freeSlot(busy, at(9.5), at(21), 60), { start: at(12), end: at(13) });
  assert.deepEqual(freeSlot(busy, at(11), at(21), 90), { start: at(14), end: at(15.5) });
  assert.equal(freeSlot(busy, at(10), at(12), 30), null);
  assert.equal(slotLength(280, 5), 60);
  assert.equal(slotLength(20, 5), 30);
  assert.equal(slotLength(900, 2), 90);
});

test("morning: today against each budget, the stretch at risk and two moves", () => {
  const m = computeMoment({
    kind: "morning",
    events: [...history(), ...todayPlan()],
    goals,
    now: T("2026-11-11 07:30"),
  });
  const full = Moment.parse({ ...m, headline: templateHeadline(m), phrased_by: "template" });
  assert.equal(full.day, "2026-11-11");

  const work = m.goals.find((g) => g.goal_id === W);
  assert.deepEqual(work, {
    goal_id: W,
    title: "Deep work",
    category: "work",
    area: "business",
    kind: "time",
    sleep: false,
    budget_minutes: 600,
    spent_week_minutes: 200, // 2 x (120 planned less 20 lost)
    planned_today_minutes: 120,
    spent_today_minutes: 0,
    lost_today_minutes: 0,
    planned_ahead_minutes: 120,
    unplanned_minutes: 280, // 600 - 200 - 120
  });
  const gym = m.goals.find((g) => g.goal_id === G);
  assert.equal(gym?.spent_week_minutes, 60);
  assert.equal(gym?.unplanned_minutes, 180);
  const rest = m.goals.find((g) => g.goal_id === R);
  assert.equal(rest?.spent_today_minutes, 480);
  // The screens hide the sleep goal from time lines by this flag, not by category.
  assert.equal(rest?.sleep, true);
  assert.equal(rest?.area, "health");
  assert.equal(gym?.sleep, false);
  assert.equal(rest?.planned_today_minutes, 450);
  assert.equal(rest?.unplanned_minutes, null);

  assert.equal(m.totals.planned_minutes, 120);
  assert.equal(m.totals.baseline_lost_minutes, 20);
  assert.equal(m.totals.won_back_minutes, 0);

  assert.equal(m.at_risk?.title, "Deep work: pitch");
  assert.equal(m.at_risk?.goal_id, W);
  assert.equal(m.at_risk?.expected_lost_minutes, 20);
  assert.equal(m.at_risk?.history_days, 2);
  assert.equal(m.at_risk?.usual_trigger, "Instagram");

  assert.equal(m.suggestions.length, 2);
  assert.equal(m.suggestions[0]?.title, "Silence Instagram from 10:00 to 12:00");
  assert.equal(m.suggestions[0]?.action_kind, "block_mac_app");
  assert.equal(m.suggestions[1]?.title, "Book 60 minutes of deep work at 08:00");
  assert.equal(m.suggestions[1]?.action_kind, "create_focus_block");
  assert.equal(
    m.suggestions[1]?.rationale,
    "400 of 600 minutes for Deep work left this week and 120 planned, so 280 are not booked.",
  );
  assert.equal(m.lesson, null);
  assert.equal(m.first_move, null);
  assert.equal(
    templateHeadline(m),
    "Today holds 2h 00 of goal time. Guard 10:00 to 12:00: it usually costs 20 minutes.",
  );
});

test("evening: plan against what happened, won back, one lesson, tomorrow's first move", () => {
  const today = [
    mac(APPS.editor, T("2026-11-11 10:00"), T("2026-11-11 10:55")),
    mac(APPS.social, T("2026-11-11 10:55"), T("2026-11-11 11:00")),
    mac(APPS.editor, T("2026-11-11 11:00"), T("2026-11-11 12:00")),
    calendar("Deep work: tests", T("2026-11-12 09:00"), T("2026-11-12 10:30")),
  ];
  const m = computeMoment({
    kind: "evening",
    events: [...history(), ...todayPlan(), ...today],
    goals,
    now: T("2026-11-11 21:00"),
  });
  Moment.parse({ ...m, headline: templateHeadline(m), phrased_by: "template" });

  assert.equal(m.goals.find((g) => g.goal_id === W)?.spent_today_minutes, 115);
  assert.equal(m.goals.find((g) => g.goal_id === W)?.lost_today_minutes, 5);
  assert.deepEqual(m.totals, {
    planned_minutes: 120,
    spent_minutes: 115,
    lost_minutes: 5,
    baseline_lost_minutes: 20,
    won_back_minutes: 15,
  });
  assert.equal(m.at_risk, null);
  assert.deepEqual(m.suggestions, []);
  assert.equal(m.lesson, "Instagram cost 5 minutes in 1 interruption today.");
  assert.equal(m.first_move?.title, "Start Deep work: tests at 09:00");
  assert.equal(
    m.first_move?.rationale,
    "First goal block tomorrow: 90 minutes for Deep work. Put Instagram away before it starts.",
  );
  assert.equal(
    templateHeadline(m),
    "115 minutes of 2h 00 planned goal time held, 5 minutes lost. 15 minutes won back on your usual day.",
  );
});

test("evening without a block tomorrow books the biggest gap", () => {
  const m = computeMoment({
    kind: "evening",
    events: [...history(), ...todayPlan()],
    goals,
    now: T("2026-11-11 21:00"),
  });
  assert.equal(m.first_move?.title, "Book 60 minutes of deep work at 08:00 tomorrow");
  assert.equal(m.first_move?.start_at, "2026-11-12T06:00:00.000Z");
});

test("a new user with no data gets budgets and no invented risk", () => {
  const m = computeMoment({ kind: "morning", events: [], goals, now: T("2026-11-11 07:30") });
  assert.equal(m.at_risk, null);
  assert.equal(m.totals.baseline_lost_minutes, null);
  assert.equal(m.suggestions.length, 1);
  assert.equal(m.suggestions[0]?.goal_id, W);
  assert.equal(
    templateHeadline(m),
    "Nothing booked for your goals today. Book 90 minutes of deep work at 08:00.",
  );
  const empty = computeMoment({ kind: "evening", events: [], goals: [], now: T("2026-11-11 21:00") });
  assert.equal(empty.lesson, "No goal blocks today. Time you do not book goes elsewhere.");
  assert.equal(empty.first_move, null);
});

test("a model line is used only when it keeps the voice and invents no number", () => {
  const m = computeMoment({
    kind: "morning",
    events: [...history(), ...todayPlan()],
    goals,
    now: T("2026-11-11 07:30"),
  });
  const facts = factsFor(m);
  assert.ok(
    acceptable("Two hours of goal time today. Guard 10:00 to 12:00, Instagram costs you 20 minutes.", facts),
  );
  assert.ok(!acceptable("Guard 10:00 to 12:00, it costs you 35 minutes.", facts));
  assert.ok(!acceptable("Big day ahead! Guard your block.", facts));
  // A line cut off by the token limit is never shown (seen in production, 14 Nov).
  assert.ok(!acceptable("Two hours of goal time today and 20 minutes l", facts));
  assert.ok(!acceptable("Guard your block — it matters.", facts));
  assert.ok(!acceptable("Protect your productivity this morning.", facts));
});
