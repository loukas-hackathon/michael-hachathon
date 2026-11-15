import assert from "node:assert/strict";
import { test } from "node:test";
import type { Goal } from "@michael/shared";
import { APPS as apps, calendar, dataOf, goal, mac, report, T } from "../patterns/testkit";
import { goalBlockTitle, goalForEvent, isOwnBlock } from "./match";

// Synthetic goals and titles only. The shape is the real problem: nobody names a calendar event
// after the goal it serves.

const withTitles = (g: Goal, titles: unknown): Goal => ({ ...g, target: { calendar_titles: titles } });

const TRI = withTitles(goal("gym", "10000000-0000-4000-8000-000000000002", "Triathlon"), [
  "Gym",
  "Swimming",
  "Run",
]);
const COMPANY = withTitles(goal("work", "10000000-0000-4000-8000-000000000001", "The company"), [
  "Cold Outreach / Sales",
  "Weekly marketing material",
]);
const UNI = withTitles(goal("work", "10000000-0000-4000-8000-000000000005", "University"), [
  "Study",
  "Φροντιστήριο",
]);
const GOALS = [TRI, COMPANY, UNI];

const event = (title: string, data: Record<string, unknown> = {}) =>
  calendar(title, T("2026-11-10 10:00"), T("2026-11-10 11:00"), data);
const match = (title: string, data: Record<string, unknown> = {}, goals = GOALS) => {
  const m = goalForEvent(event(title, data), goals);
  return m ? [m.goal.title, m.rule] : null;
};

test("calendar_titles: a title that equals an entry or starts with it belongs to the goal", () => {
  assert.deepEqual(match("Gym"), ["Triathlon", "calendar_titles"]);
  assert.deepEqual(match("Swimming 1,500m"), ["Triathlon", "calendar_titles"]);
  assert.deepEqual(match("Cold Outreach / Sales"), ["The company", "calendar_titles"]);
  assert.deepEqual(match("Study: Accounting II"), ["University", "calendar_titles"]);
  assert.equal(match("Dentist"), null);
});

test("calendar_titles: case, accents and extra spaces do not matter", () => {
  assert.deepEqual(match("  gym "), ["Triathlon", "calendar_titles"]);
  assert.deepEqual(match("WEEKLY  MARKETING MATERIAL"), ["The company", "calendar_titles"]);
  assert.deepEqual(match("ΦΡΟΝΤΙΣΤΗΡΙΟ Λογιστική"), ["University", "calendar_titles"]);
});

test("calendar_titles: an entry ends at a word boundary", () => {
  assert.deepEqual(match("Run"), ["Triathlon", "calendar_titles"]);
  assert.deepEqual(match("Run: 8 km easy"), ["Triathlon", "calendar_titles"]);
  assert.equal(match("Runway review"), null);
  assert.equal(match("Gymnastics show"), null);
});

test("calendar_titles: the longest matching entry wins, and entries that are not text are skipped", () => {
  const broad = withTitles(goal("work", "10000000-0000-4000-8000-000000000006", "Reading"), ["Study"]);
  const narrow = withTitles(goal("work", "10000000-0000-4000-8000-000000000007", "Finance exam"), [
    "Study: Finance",
    7,
    "",
  ]);
  assert.deepEqual(match("Study: Finance, chapter 3", {}, [broad, narrow]), [
    "Finance exam",
    "calendar_titles",
  ]);
  assert.deepEqual(match("Study: History", {}, [broad, narrow]), ["Reading", "calendar_titles"]);
  const broken = withTitles(goal("work", "10000000-0000-4000-8000-000000000008", "Broken"), "Study");
  assert.equal(match("Study", {}, [broken]), null);
});

test("an event with other people in it is never the user's own block", () => {
  assert.equal(match("Gym", { attendees: 1 }), null);
  assert.equal(match("Cold Outreach / Sales", { attendees: 3 }), null);
  assert.equal(match("Anything", { attendees: 2, goal_id: COMPANY.id }), null);
  assert.deepEqual(match("Gym", { attendees: 0 }), ["Triathlon", "calendar_titles"]);
  assert.equal(isOwnBlock(event("Gym", { attendees: 1 })), false);
  assert.equal(isOwnBlock(event("Gym")), true);
});

test("fallbacks, in order: goal_id, calendar_titles, goal_category, the goal's title, a category word", () => {
  // goal_id beats the title list.
  assert.deepEqual(match("Gym", { goal_id: COMPANY.id }), ["The company", "goal_id"]);
  // The title list beats a category.
  assert.deepEqual(match("Gym", { goal_category: "work" }), ["Triathlon", "calendar_titles"]);
  // A category names the first goal of that category.
  assert.deepEqual(match("Block", { goal_category: "gym" }), ["Triathlon", "goal_category"]);
  assert.deepEqual(match("Block", { category: "work" }), ["The company", "goal_category"]);
  // The goal's own title at the start of the event title.
  assert.deepEqual(match("University: thesis"), ["University", "goal_title"]);
  assert.deepEqual(match("the company, pricing page"), ["The company", "goal_title"]);
  // A category word, or "deep work" and "focus" for work.
  assert.deepEqual(match("Work: pitch deck"), ["The company", "category_word"]);
  assert.deepEqual(match("Morning focus"), ["The company", "category_word"]);
  assert.equal(match("Rest day"), null); // no rest goal in the list
});

test("the patterns' calendar mode reads the same matcher", () => {
  const r = report(
    [
      calendar("Cold Outreach / Sales", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
      calendar("Cold Outreach / Sales", T("2026-11-10 12:00"), T("2026-11-10 13:00"), { attendees: 1 }),
      mac(apps.editor, T("2026-11-10 10:00"), T("2026-11-10 10:20")),
      mac(apps.chat, T("2026-11-10 10:20"), T("2026-11-10 10:25")),
      mac(apps.editor, T("2026-11-10 10:25"), T("2026-11-10 11:00")),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
    { goals: GOALS },
  );
  assert.equal(r.inputs.goal_blocks, 1);
  const d = dataOf(r.focus_disruptions);
  assert.equal(d.mode, "calendar");
  assert.equal(d.items[0]?.goal_id, COMPANY.id);
  assert.equal(d.items[0]?.minutes_lost, 5);
});

test("a block booked for a goal names the goal, and still counts towards it", () => {
  assert.equal(goalBlockTitle(UNI), "University study");
  assert.equal(goalBlockTitle(TRI), "Triathlon gym");
  assert.equal(goalBlockTitle(COMPANY), "The company cold outreach / sales");
  for (const g of GOALS) assert.equal(goalForEvent(event(goalBlockTitle(g)), GOALS)?.goal.id, g.id);
  // A calendar title that already says the goal, or a goal title that holds it, is used as it is.
  assert.equal(goalBlockTitle(withTitles(UNI, ["University revision"])), "University revision");
  assert.equal(goalBlockTitle({ ...TRI, title: "Gym and swim" }), "Gym and swim");
  // No calendar titles: the goal's own title. An acronym keeps its capitals.
  assert.equal(goalBlockTitle(withTitles(UNI, [])), "University");
  assert.equal(goalBlockTitle(withTitles(UNI, ["MBA prep"])), "University MBA prep");
  // A name someone gave is kept, unless it is one of the goal's bare calendar titles.
  assert.equal(goalBlockTitle(UNI, "Revise chapter 3"), "Revise chapter 3");
  assert.equal(goalBlockTitle(UNI, "study"), "University study");
});
