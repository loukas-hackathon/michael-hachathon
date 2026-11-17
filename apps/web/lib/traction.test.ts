import assert from "node:assert/strict";
import { test } from "node:test";
import { type Traction, voiceProblems } from "@michael/shared";
import { headlineRows, investorSummary, pct, waitPhrase, weekLabel } from "./traction";

const goalWeek = (week_start: string, users: number) => ({
  week_start,
  users,
  planned_minutes: users ? 900 : 0,
  elapsed_minutes: users ? 300 : 0,
  spent_minutes: users ? 240 : 0,
  share: users ? 0.8 : null,
  won_back_minutes: users ? 135 : 0,
});

const sample: Traction = {
  generated_at: "2026-11-17T10:00:00.000Z",
  timezone: "Europe/Athens",
  excluded_accounts: 2,
  sign_ups: {
    total: 42,
    weeks: [
      { week_start: "2026-11-09", sign_ups: 12, active: 9 },
      { week_start: "2026-11-16", sign_ups: 30, active: 25 },
    ],
  },
  activation: { activated: 21, share: 0.5, median_minutes_to_first_source: 47 },
  active: { daily: 11, daily_average_7d: 9.4, weekly: 25, rule: "Active." },
  retention: { cohorts: [], week_1: 0.6, week_2: null, week_4: null },
  goal_time: {
    this_week: goalWeek("2026-11-16", 4),
    last_week: goalWeek("2026-11-09", 0),
    users_scored: 4,
    capped: false,
  },
  engagement: {
    actions_done: 18,
    actions_undone: 2,
    chat_messages: 140,
    nudges_sent: 1,
    connector_queries: 33,
  },
};

test("pct, weekLabel and waitPhrase", () => {
  assert.equal(pct(0.4249), "42%");
  assert.equal(pct(null), null);
  assert.equal(weekLabel("2026-11-16"), "16 Nov");
  assert.equal(waitPhrase(47), "47 minutes");
  assert.equal(waitPhrase(135), "2h 15");
  assert.equal(waitPhrase(3 * 1440 + 100), "3 days");
});

test("investorSummary: the numbers in Michael's voice, nothing per user", () => {
  const text = investorSummary(sample);
  assert.deepEqual(voiceProblems(text), []);
  assert.match(text, /^Michael traction, 17 November 2026/);
  assert.match(text, /Sign ups: 42 in all, 30 this week, 12 last week\./);
  assert.match(
    text,
    /Activation: 50% connected a real source \(21 of 42\), median 47 minutes from sign up\./,
  );
  assert.match(text, /Active: 25 people in the last 7 days, 11 today\./);
  assert.match(text, /week 1 60%, week 2 not measurable yet, week 4 not measurable yet/);
  assert.match(
    text,
    /Goal time this week: 80% of planned time kept so far \(4h of 5h, 4 people\); 2h 15 won back\./,
  );
  assert.doesNotMatch(text, /Goal time last week/);
  assert.match(
    text,
    /18 actions carried out \(2 undone\), 140 chat messages, 1 nudge sent, 33 Claude connector queries\./,
  );
});

test("headlineRows: four rows, each with a value and a note", () => {
  const rows = headlineRows(sample);
  assert.deepEqual(
    rows.map((r) => [r.label, r.value]),
    [
      ["Weekly active", "25"],
      ["Activation", "50%"],
      ["Week 4 retention", "Not yet"],
      ["Won back this week", "2h 15"],
    ],
  );
  for (const r of rows) assert.deepEqual(voiceProblems(`${r.label} ${r.value} ${r.note}`), []);
});
