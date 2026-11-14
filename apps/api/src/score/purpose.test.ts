import assert from "node:assert/strict";
import { test } from "node:test";
import { AppCategory, type Event, type Goal, Score } from "@michael/shared";
import { APPS, calendar, dataOf, goal, mac, phone, report, T, workout } from "../patterns/testkit";
import { purposeOf, workCategories } from "./purpose";
import { buildScore } from "./score";

// What a minute of attention means inside a goal's block: one rule (score/purpose.ts), read by the
// score and by the patterns' calendar mode. Every title, app and time here is made up.

const make = (
  category: Goal["category"],
  n: number,
  title: string,
  target: Record<string, unknown>,
): Goal => ({ ...goal(category, `10000000-0000-4000-8000-00000000000${n}`, title), target });

const SALES = make("business", 1, "Sales", {
  calendar_titles: ["Call Leads"],
  work_categories: ["communication"],
});
const PRODUCT = make("business", 2, "Product", { calendar_titles: ["Build"] });
const TRI = make("health", 3, "Triathlon", { calendar_titles: ["Gym"] });
const FUN = make("personal", 4, "Fun", { label: "fun", calendar_titles: ["Night out"] });
const GOALS = [SALES, PRODUCT, TRI, FUN];

const DAY = "2026-11-10";
const at = (time: string) => T(`${DAY} ${time}`);

const scoreOf = (events: Event[], goals: Goal[] = GOALS) =>
  Score.parse(buildScore(events, goals, { date: DAY, now: T("2026-11-11 00:00") }));

/** The patterns' calendar mode for the same day: [app, goal, minutes lost] per disruption, in order. */
const disruptionsOf = (events: Event[], goals: Goal[] = GOALS) => {
  const r = report(events, `${DAY} 00:00`, "2026-11-11 00:00", { goals });
  const d = dataOf(r.focus_disruptions);
  return {
    items: [...d.items]
      .reverse()
      .filter((i) => i.mode === "calendar")
      .map((i) => [i.trigger.name, goals.find((g) => g.id === i.goal_id)?.title, i.minutes_lost]),
    lost: d.minutes_lost,
    focus: d.focus_minutes,
  };
};

const block = (s: Score, title: string) => {
  const found = s.day.blocks.find((b) => b.title === title);
  assert.ok(found, `no block titled ${title}`);
  return found;
};
/** [elapsed, spent, lost, verified] of a block. */
const four = (b: Score["day"]["blocks"][number]) => [
  b.elapsed_minutes,
  b.spent_minutes,
  b.lost_minutes,
  b.spent_minutes - b.unverified_minutes,
];

test("purposeOf: the rule, category by category", () => {
  const names = (g: Goal) => Object.fromEntries(AppCategory.options.map((c) => [c, purposeOf(g, c)]));
  assert.deepEqual(names(PRODUCT), {
    work: "on",
    communication: "off",
    social: "off",
    video: "off",
    news: "off",
    shopping: "off",
    travel: "off",
    ai: "on",
    music: "neutral",
    system: "neutral",
    other: "neutral",
  });
  // A sales goal lists communication: there it is the work. Everything else as for any business goal.
  assert.deepEqual(names(SALES), { ...names(PRODUCT), communication: "on" });
  // Health and personal: work is off purpose too.
  assert.deepEqual(names(TRI), { ...names(PRODUCT), work: "off", ai: "off" });
  assert.deepEqual(names(FUN), names(TRI));
  // The older category names read the same way.
  assert.deepEqual(names(goal("work", SALES.id)), names(PRODUCT));
  for (const old of ["gym", "rest", "food"] as const) assert.deepEqual(names(goal(old, TRI.id)), names(TRI));

  // Entries that are not categories are skipped, as with calendar_titles.
  assert.deepEqual(
    workCategories(make("business", 5, "Odd", { work_categories: ["communication", "email", 7] })),
    ["communication"],
  );
  assert.deepEqual(workCategories(make("business", 5, "Odd", { work_categories: "communication" })), []);
});

test("work_categories: messaging inside a sales block is spent and verified, in the score and in the patterns", () => {
  const events = [
    // The sales block: 30 minutes of messages, 10 of an editor, 10 of Instagram, 10 of nothing.
    calendar("Call Leads", at("10:00"), at("11:00")),
    mac(APPS.chat, at("10:00"), at("10:30")),
    mac(APPS.editor, at("10:30"), at("10:40")),
    phone(APPS.social, at("10:40"), at("10:50")),
    // The same messages inside another goal's block are still a distraction.
    calendar("Build", at("14:00"), at("15:00")),
    mac(APPS.editor, at("14:00"), at("14:30")),
    mac(APPS.chat, at("14:30"), at("14:40")),
    mac(APPS.editor, at("14:40"), at("15:00")),
  ];

  const s = scoreOf(events);
  //                                      elapsed spent lost verified
  assert.deepEqual(four(block(s, "Call Leads")), [60, 50, 10, 40]);
  assert.deepEqual(four(block(s, "Build")), [60, 50, 10, 50]);
  assert.deepEqual(
    block(s, "Call Leads").lost.map((l) => [l.what, l.category, l.minutes]),
    [["Instagram", "social", 10]],
  );
  assert.deepEqual(
    block(s, "Build").lost.map((l) => [l.what, l.category, l.minutes]),
    [["WhatsApp", "communication", 10]],
  );

  const p = disruptionsOf(events);
  assert.deepEqual(p.items, [
    ["Instagram", "Sales", 10],
    ["WhatsApp", "Product", 10],
  ]);
  // The two numbers agree: what the score calls lost is what the patterns call a disruption.
  assert.equal(p.lost, s.day.lost_minutes);
  // Time on purpose counts the messages in the sales block: 40 there, 50 in the other.
  assert.equal(p.focus, 90);

  // Without the list the same sales block loses the messages too: 40 lost, only the editor verified.
  const plain = { ...SALES, target: { calendar_titles: ["Call Leads"] } };
  const before = scoreOf(events, [plain, PRODUCT, TRI, FUN]);
  assert.deepEqual(four(block(before, "Call Leads")), [60, 20, 40, 10]);
  assert.deepEqual(four(block(before, "Build")), [60, 50, 10, 50]);
  const beforePatterns = disruptionsOf(events, [plain, PRODUCT, TRI, FUN]);
  assert.deepEqual(beforePatterns.items, [
    ["WhatsApp", "Sales", 30],
    ["Instagram", "Sales", 10],
    ["WhatsApp", "Product", 10],
  ]);
  assert.equal(beforePatterns.lost, before.day.lost_minutes);
});

test("work inside a health block is lost, in the score and in the patterns", () => {
  const events = [
    calendar("Gym", at("18:00"), at("19:00")),
    mac(APPS.editor, at("18:10"), at("18:30")), // a work app during training
    phone(APPS.chat, at("18:40"), at("18:45")),
    mac(APPS.finder, at("18:50"), at("18:55")), // neutral: neither lost nor proof
  ];
  const s = scoreOf(events);
  //                               elapsed spent lost verified
  assert.deepEqual(four(block(s, "Gym")), [60, 35, 25, 0]);
  assert.deepEqual(
    block(s, "Gym").lost.map((l) => [l.what, l.category, l.minutes]),
    [
      ["VS Code", "work", 20],
      ["WhatsApp", "communication", 5],
    ],
  );
  const p = disruptionsOf(events);
  assert.deepEqual(p.items, [
    ["VS Code", "Triathlon", 20],
    ["WhatsApp", "Triathlon", 5],
  ]);
  assert.equal(p.lost, s.day.lost_minutes);

  // A recorded workout proves what is left of the hour, never the lost part.
  const proven = scoreOf([...events, workout(at("18:00"), at("19:00"))]);
  assert.deepEqual(four(block(proven, "Gym")), [60, 35, 25, 35]);

  // The older category name `gym` follows the same rule.
  const old = scoreOf(events, [SALES, PRODUCT, { ...TRI, category: "gym" }, FUN]);
  assert.deepEqual(four(block(old, "Gym")), [60, 35, 25, 0]);

  // Unless the goal says the category is its work: a coach who plans sessions in a work app.
  const listed = { ...TRI, target: { calendar_titles: ["Gym"], work_categories: ["work"] } };
  const allowed = scoreOf(events, [SALES, PRODUCT, listed, FUN]);
  assert.deepEqual(four(block(allowed, "Gym")), [60, 55, 5, 20]);
  assert.deepEqual(disruptionsOf(events, [SALES, PRODUCT, listed, FUN]).items, [
    ["WhatsApp", "Triathlon", 5],
  ]);
});

test("work inside a personal block is lost too; inside a business block it is the work", () => {
  const events = [
    calendar("Night out", at("21:00"), at("22:00")),
    mac(APPS.editor, at("21:00"), at("21:15")),
    calendar("Build", at("09:00"), at("10:00")),
    mac(APPS.editor, at("09:00"), at("09:15")),
  ];
  const s = scoreOf(events);
  assert.deepEqual(four(block(s, "Night out")), [60, 45, 15, 0]);
  assert.deepEqual(four(block(s, "Build")), [60, 60, 0, 15]);
  const p = disruptionsOf(events);
  assert.deepEqual(p.items, [["VS Code", "Fun", 15]]);
  assert.equal(p.lost, s.day.lost_minutes);
});
