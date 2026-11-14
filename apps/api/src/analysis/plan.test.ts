import assert from "node:assert/strict";
import { test } from "node:test";
import { type Goal, GoalCategory } from "@michael/shared";
import { calendar, goal, T } from "../patterns/testkit";
import { matchableGoals, planEvents } from "./plan";

// Every title, name and time here is made up. The matching rules themselves are tested where
// they live (score/match.test.ts); this file tests how the brief sorts what they return.

// The brief never depends on what the categories are called: any two will do.
const first = GoalCategory.options[0] as Goal["category"];
const second = GoalCategory.options[1] as Goal["category"];
const withTitles = (g: Goal, titles: string[]): Goal => ({ ...g, target: { calendar_titles: titles } });
const training = withTitles(goal(first, "10000000-0000-4000-8000-00000000000a", "Race"), ["Swim", "Track"]);
const study = withTitles(goal(second, "10000000-0000-4000-8000-00000000000b", "Degree"), ["Study"]);
const goals = [training, study];

test("planEvents sorts every calendar event into goal block, own entry or busy time", () => {
  const events = [
    calendar("Swim with a friend", T("2026-11-10 18:00"), T("2026-11-10 19:00"), { attendees: 1 }),
    calendar("Study: accounting", T("2026-11-10 10:00"), T("2026-11-10 12:00")),
    calendar("Pick up the car", T("2026-11-10 13:00"), T("2026-11-10 13:30")),
    calendar("swim 1,500m", T("2026-11-10 07:00"), T("2026-11-10 08:00"), { attendees: 0 }),
  ];
  const plan = planEvents(events, goals);
  assert.deepEqual(
    plan.map((p) => [p.kind, p.goal?.id ?? null, p.title]),
    [
      ["goal_block", training.id, "swim 1,500m"],
      ["goal_block", study.id, "Study: accounting"],
      ["own_other", null, "Pick up the car"],
      ["busy", null, "Swim with a friend"],
    ],
  );
  assert.equal(plan[1]?.eventId, events[1]?.id);
});

test("an event with anyone else in it is never the user's own block, whatever its title", () => {
  const kinds = (data: Record<string, unknown>) =>
    planEvents(
      [calendar("Study: accounting", T("2026-11-10 10:00"), T("2026-11-10 12:00"), data)],
      goals,
    ).map((p) => p.kind);
  assert.deepEqual(kinds({}), ["goal_block"]);
  assert.deepEqual(kinds({ attendees: 0 }), ["goal_block"]);
  assert.deepEqual(kinds({ attendees: 1 }), ["busy"]);
  assert.deepEqual(kinds({ attendees: 4 }), ["busy"]);
  // A source that lists the people instead of counting them.
  assert.deepEqual(kinds({ attendees: ["someone@example.com"] }), ["busy"]);
  // Naming the goal on the event does not make a meeting the user's own either.
  assert.deepEqual(kinds({ attendees: 1, goal_id: study.id }), ["busy"]);
});

test("only active goals take blocks, and events without an end are not blocks", () => {
  const event = calendar("Study: accounting", T("2026-11-10 10:00"), T("2026-11-10 12:00"));
  assert.deepEqual(
    planEvents([event], [{ ...study, active: false }, training]).map((p) => p.kind),
    ["own_other"],
  );
  assert.deepEqual(matchableGoals([{ ...study, active: false }, training]), [training]);
  assert.deepEqual(planEvents([{ ...event, end_at: null }], goals), []);
  assert.deepEqual(planEvents([{ ...event, type: "note" }], goals), []);
});
