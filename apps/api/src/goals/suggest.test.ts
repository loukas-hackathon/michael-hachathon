import assert from "node:assert/strict";
import { test } from "node:test";
import { type Event, type Goal, GoalSuggestion, voiceProblems } from "@michael/shared";
import { buildDemoWeek, demoGoals, stableUuid } from "../demo/week";
import { calendar, goal, T } from "../patterns/testkit";
import { daysText, stableLabel, suggestGoals, themeOf } from "./suggest";

// A student founder's calendar, made up: the gym three mornings a week, deep work on Tuesdays and
// Thursdays, two lectures, a daily stand up with the team and some one-off noise. Four weeks back
// from Saturday 14 November 2026 plus the week ahead.

const NOW = T("2026-11-14 12:00");
const MONDAYS = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"];

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function studentMonth(): Event[] {
  const out: Event[] = [];
  MONDAYS.forEach((mon, w) => {
    const day = (n: number) => addDays(mon, n);
    for (const n of [0, 2, 4]) out.push(calendar("Gym", T(`${day(n)} 07:00`), T(`${day(n)} 08:30`)));
    out.push(
      calendar(w === 1 ? "Deep work: pitch deck" : "Deep work", T(`${day(1)} 09:00`), T(`${day(1)} 12:00`)),
    );
    out.push(calendar("Deep work", T(`${day(3)} 09:00`), T(`${day(3)} 12:00`), { recurring: true }));
    out.push(calendar("Lecture: Microeconomics", T(`${day(0)} 14:00`), T(`${day(0)} 16:00`)));
    out.push(calendar("Lecture: Statistics", T(`${day(2)} 14:00`), T(`${day(2)} 16:00`)));
    for (const n of [0, 1, 2, 3, 4]) {
      out.push(calendar("Team stand up", T(`${day(n)} 10:00`), T(`${day(n)} 10:15`), { attendees: 4 }));
    }
  });
  // Noise: once only, with other people, all day, or not a habit at all.
  out.push(calendar("Dentist", T("2026-10-22 17:00"), T("2026-10-22 18:00")));
  out.push(calendar("Flight to London", T("2026-11-05 06:00"), T("2026-11-05 09:30")));
  out.push(calendar("Haircut", T("2026-11-11 18:00"), T("2026-11-11 18:45")));
  out.push(calendar("Coffee with a friend", T("2026-11-03 18:00"), T("2026-11-03 19:00"), { attendees: 1 }));
  out.push(calendar("Investor call", T("2026-11-10 16:00"), T("2026-11-10 16:30"), { with_others: true }));
  out.push(calendar("Holiday", T("2026-10-28 00:00"), T("2026-10-29 00:00"), { all_day: true }));
  // Before the window: four weeks back means nothing from early October.
  out.push(calendar("Piano", T("2026-10-05 19:00"), T("2026-10-05 20:00")));
  out.push(calendar("Piano", T("2026-10-07 19:00"), T("2026-10-07 20:00")));
  return out;
}

const summary = (s: GoalSuggestion[]) =>
  s.map((x) => [x.id, x.title, x.weekly_budget_minutes, x.target.calendar_titles.join("|")]);

test("a student's month: deep work, training and university, nothing else", () => {
  const out = suggestGoals(studentMonth(), [], { now: NOW });
  for (const s of out) {
    GoalSuggestion.parse(s);
    assert.deepEqual(voiceProblems(s.evidence), [], s.evidence);
  }
  assert.deepEqual(summary(out), [
    ["deep_work", "Deep work", 360, "Deep work"],
    ["training", "Training", 270, "Gym"],
    ["study", "University", 240, "Lecture"],
  ]);
  const gym = out.find((s) => s.id === "training");
  assert.equal(gym?.evidence, "Gym, Mon, Wed and Fri, 4h 30 a week.");
  assert.deepEqual(gym?.days, ["mon", "wed", "fri"]);
  assert.equal(gym?.sessions_per_week, 3);
  assert.equal(gym?.area, "health");
  assert.equal(out.find((s) => s.id === "deep_work")?.evidence, "Deep work, Tue and Thu, 6h a week.");
});

test("titles an active goal already counts are skipped, a paused goal does not hide them", () => {
  const training: Goal = { ...goal("gym", stableUuid("t"), "70.3"), target: { calendar_titles: ["Gym"] } };
  const ids = (goals: Goal[]) => suggestGoals(studentMonth(), goals, { now: NOW }).map((s) => s.id);
  assert.deepEqual(ids([training]), ["deep_work", "study"]);
  assert.deepEqual(ids([{ ...training, active: false }]), ["deep_work", "training", "study"]);
  // A goal named like the suggestion counts its blocks by title already.
  assert.deepEqual(ids([goal("work", stableUuid("d"), "Deep work")]), ["training", "study"]);
});

test("different sports pool into one training goal, a lone unknown title is noise", () => {
  const events = [
    calendar("Gym", T("2026-11-09 20:30"), T("2026-11-09 22:30")),
    calendar("Swimming 1,500m", T("2026-11-10 20:00"), T("2026-11-10 21:30")),
    calendar("Run: 8 km", T("2026-11-13 08:30"), T("2026-11-13 09:30")),
    calendar("Rhefuel", T("2026-11-15 09:00"), T("2026-11-15 10:30")),
  ];
  const out = suggestGoals(events, [], { now: NOW });
  assert.deepEqual(summary(out), [["training", "Training", 270, "Gym|Swimming|Run"]]);
  assert.equal(out[0]?.evidence, "Gym, Swimming and Run, Mon, Tue and Fri, 4h 30 a week.");

  // Google says it repeats: then once is enough.
  events[3] = calendar("Rhefuel", T("2026-11-15 09:00"), T("2026-11-15 10:30"), { recurring: true });
  const again = suggestGoals(events, [], { now: NOW });
  assert.deepEqual(
    again.map((s) => [s.id, s.title, s.area]),
    [
      ["training", "Training", "health"],
      ["title:rhefuel", "Rhefuel", "personal"],
    ],
  );
});

test("Michael's own bookings and empty calendars give nothing", () => {
  const mine = [
    calendar("Focus", T("2026-11-10 09:00"), T("2026-11-10 11:00"), { michael: true }),
    calendar("Focus", T("2026-11-11 09:00"), T("2026-11-11 11:00"), { michael: true }),
  ];
  assert.deepEqual(suggestGoals(mine, [], { now: NOW }), []);
  assert.deepEqual(suggestGoals([], [], { now: NOW }), []);
});

test("the demo week: training, the company, study and the Sunday ride, all goals in the demo plan already", () => {
  const now = new Date(NOW);
  const events: Event[] = buildDemoWeek(now).events.map((e, i) => ({
    ...e,
    id: stableUuid(`demo-${i}`),
    end_at: e.end_at ?? null,
    external_id: e.external_id ?? null,
    created_at: NOW,
  }));
  const out = suggestGoals(events, [], { now });
  for (const s of out) GoalSuggestion.parse(s);
  assert.deepEqual(summary(out), [
    ["training", "Training", 450, "Gym|Swimming|Run|Yoga"],
    ["business", "Business", 420, "Cold Outreach|Weekly marketing material|Meeting Preparation"],
    ["study", "Study", 240, "Φροντιστήριο"],
    // His Sunday long ride: twice in the eight days the demo shows, still once a week.
    ["title:rhefuel", "Rhefuel", 90, "Rhefuel"],
  ]);
  // The plan already holds all of them, so a demo account sees none until a goal is removed.
  assert.deepEqual(suggestGoals(events, demoGoals, { now }), []);
});

test("labels, themes and days in words", () => {
  assert.equal(stableLabel("Lecture: Pricing Strategy"), "Lecture");
  assert.equal(stableLabel("Cold Outreach / Sales"), "Cold Outreach");
  assert.equal(stableLabel("Swimming 1,500m"), "Swimming");
  assert.equal(stableLabel("Gym - legs"), "Gym");
  assert.equal(stableLabel("Run 10k"), "Run");
  assert.equal(stableLabel("Weekly marketing material"), "Weekly marketing material");
  assert.equal(themeOf("Φροντιστήριο"), "study");
  assert.equal(themeOf("Runway review"), null);
  assert.equal(themeOf("Commute"), "skip");
  assert.equal(daysText(["tue", "mon", "wed", "thu"]), "Mon to Thu");
  assert.equal(daysText(["tue", "thu"]), "Tue and Thu");
  assert.equal(daysText(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]), "every day");
});
