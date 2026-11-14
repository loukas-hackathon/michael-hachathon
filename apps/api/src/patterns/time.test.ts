import assert from "node:assert/strict";
import { test } from "node:test";
import { HOUR, Zone } from "./time";

const athens = new Zone("Europe/Athens");

test("offset is +2h in winter and +3h in summer", () => {
  assert.equal(athens.offsetAt(Date.parse("2026-11-10T12:00:00Z")), 2 * HOUR);
  assert.equal(athens.offsetAt(Date.parse("2026-07-10T12:00:00Z")), 3 * HOUR);
});

test("day and hour are local, not UTC", () => {
  // 22:30 UTC on the 10th is 00:30 on the 11th in Athens.
  const t = Date.parse("2026-11-10T22:30:00Z");
  assert.equal(athens.dayOf(t), "2026-11-11");
  assert.equal(athens.hourOf(t), 0);
  assert.equal(athens.clock(t), "00:30");
  assert.equal(athens.minuteOfDay(t), 30);
});

test("the autumn change day is 25 hours long and its start and end are local midnights", () => {
  // Athens leaves summer time on 25 October 2026 at 04:00, back to 03:00.
  const [day] = athens.days(Date.parse("2026-10-25T05:00:00Z"), Date.parse("2026-10-25T06:00:00Z"));
  assert.ok(day);
  assert.equal(day.day, "2026-10-25");
  assert.equal(new Date(day.start).toISOString(), "2026-10-24T21:00:00.000Z"); // 00:00 at +03:00
  assert.equal(new Date(day.end).toISOString(), "2026-10-25T22:00:00.000Z"); // 00:00 at +02:00
  assert.equal(day.end - day.start, 25 * HOUR);
});

test("the spring change day is 23 hours long", () => {
  // Athens enters summer time on 29 March 2026 at 03:00, forward to 04:00.
  const start = athens.startOfDay("2026-03-29");
  const end = athens.startOfDay("2026-03-30");
  assert.equal(new Date(start).toISOString(), "2026-03-28T22:00:00.000Z");
  assert.equal(end - start, 23 * HOUR);
});

test("hour of day across the autumn change: 03:00 to 04:00 happens twice", () => {
  assert.equal(athens.hourOf(Date.parse("2026-10-25T00:30:00Z")), 3); // 03:30 summer time
  assert.equal(athens.hourOf(Date.parse("2026-10-25T01:30:00Z")), 3); // 03:30 again, winter time
  assert.equal(athens.hourOf(Date.parse("2026-10-25T02:30:00Z")), 4);
});

test("a wall time resolves to the right instant on both sides of a change", () => {
  // 23:00 the evening before the change is still summer time; 23:00 on the day is winter time.
  assert.equal(new Date(athens.at("2026-10-24", 23 * 60)).toISOString(), "2026-10-24T20:00:00.000Z");
  assert.equal(new Date(athens.at("2026-10-25", 23 * 60)).toISOString(), "2026-10-25T21:00:00.000Z");
  // A wall time that happens twice resolves to the first one.
  assert.equal(new Date(athens.at("2026-10-25", 3 * 60 + 30)).toISOString(), "2026-10-25T00:30:00.000Z");
  // Minutes past 24:00 reach into the next day: 25:30 is 01:30 tomorrow.
  assert.equal(new Date(athens.at("2026-11-10", 25 * 60 + 30)).toISOString(), "2026-11-10T23:30:00.000Z");
});

test("splitByDay cuts at local midnight", () => {
  const pieces = athens.splitByDay(
    Date.parse("2026-11-10T23:30:00+02:00"),
    Date.parse("2026-11-11T00:30:00+02:00"),
  );
  assert.deepEqual(
    pieces.map((p) => [p.day, (p.end - p.start) / 60000]),
    [
      ["2026-11-10", 30],
      ["2026-11-11", 30],
    ],
  );
});

test("an unknown zone is an error, not a silent UTC", () => {
  assert.throws(() => new Zone("Mars/Olympus"));
});
