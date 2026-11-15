import assert from "node:assert/strict";
import { test } from "node:test";
import type { Score } from "@michael/shared";
import { lostWeekFrom, phoneUntilLabel, topCauses } from "./lost-week";

// Only the fields lostWeekFrom reads.
const score = (iphone: string | null, lostBy: { what: string; minutes: number }[] = [], lost = 0) =>
  ({
    date: "2026-11-15",
    lost_minutes: lost,
    days: ["09", "10", "11", "12", "13", "14", "15"].map((d) => ({
      date: `2026-11-${d}`,
      lost_minutes: 0,
      planned_minutes: 60,
    })),
    data_until: { mac: null, iphone },
    lost_by: lostBy.map((c) => ({ ...c, kind: "app", category: "social" })),
  }) as unknown as Score;

test("after midnight the phone's last data is today in Athens, not the day before in UTC", () => {
  // Sunday 15 November, 01:30 in Athens, is still Saturday 23:30 in UTC.
  const iphone = "2026-11-14T23:30:47.000Z";
  const week = lostWeekFrom(score(iphone), "2026-11-15");
  assert.equal(week.phoneUntil, iphone);
  assert.equal(phoneUntilLabel(iphone, "2026-11-15"), "01:30");
});

test("phone data from an earlier local day names that day", () => {
  // Saturday 14 November, 23:10 in Athens.
  const iphone = "2026-11-14T21:10:00.000Z";
  assert.equal(lostWeekFrom(score(iphone), "2026-11-15").phoneUntil, iphone);
  assert.equal(phoneUntilLabel(iphone, "2026-11-15"), "Saturday 23:10");
});

test("phone data dated after today, or a week without today, says nothing", () => {
  // Monday 16 November, 00:30 in Athens: later than "today" (Sunday 15).
  assert.equal(lostWeekFrom(score("2026-11-15T22:30:00.000Z"), "2026-11-15").phoneUntil, null);
  assert.equal(lostWeekFrom(score("2026-11-14T23:30:47.000Z"), "2026-11-22").phoneUntil, null);
  assert.equal(lostWeekFrom(score(null), "2026-11-15").phoneUntil, null);
});

test("what took it: the last line is the remainder of the total", () => {
  // The demo week: fifteen entries rounded one by one add up to 5h 30 under a total of 5h 28.
  const minutes = [138, 79, 27, 18, 15, 11, 11, 10, 8, 5, 3, 2, 1, 1, 1];
  const causes = lostWeekFrom(
    score(
      null,
      minutes.map((m, i) => ({ what: `App ${i}`, minutes: m })),
      328,
    ),
    "2026-11-15",
  ).causes;
  const { top, others, rest } = topCauses(causes, 328);
  assert.deepEqual(
    top.map((c) => c.minutes),
    [138, 79, 27],
  );
  assert.equal(others, 12);
  assert.equal(rest, 84);
  assert.equal(top.reduce((n, c) => n + c.minutes, 0) + rest, 328);
});

test("what took it: no remainder line without other things, and never below zero", () => {
  const three = [
    { what: "A", minutes: 30 },
    { what: "B", minutes: 20 },
    { what: "C", minutes: 10 },
  ];
  assert.deepEqual(topCauses(three, 62), { top: three, others: 0, rest: 0 });
  assert.equal(topCauses([...three, { what: "D", minutes: 1 }], 59).rest, 0);
});
