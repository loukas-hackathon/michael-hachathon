import assert from "node:assert/strict";
import { test } from "node:test";
import type { Instruction } from "@michael/shared";
import { T } from "../patterns/testkit";
import { Zone } from "../patterns/time";
import { protectedBy, protectedWindow } from "./protected";

// Which standing instructions a span of time falls under. Athens: UTC+02:00 in winter, +03:00 in
// summer; in 2026 the clocks go forward on Sunday 29 March and back on Sunday 25 October.

const rule = (n: number, i: Partial<Instruction> & Pick<Instruction, "kind" | "text">): Instruction => ({
  id: `50000000-0000-4000-8000-00000000000${n}`,
  active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  ...i,
});

const SUNDAYS = rule(1, { text: "Keep Sundays clear", kind: "clear_day", days: [0] });
const HOME = rule(2, { text: "Home every day by 21:00", kind: "home_by", time: "21:00" });
const HOME_WEEKDAYS = rule(3, {
  text: "Home by 19:30 on weekdays",
  kind: "home_by",
  time: "19:30",
  days: [1, 2, 3, 4, 5],
});
const QUIET = rule(4, {
  text: "Nothing between 22:00 and 07:00",
  kind: "quiet_hours",
  time: "22:00",
  end_time: "07:00",
});
const LUNCH = rule(5, {
  text: "Lunch is mine",
  kind: "quiet_hours",
  time: "13:00",
  end_time: "14:00",
  days: [1, 2, 3, 4, 5],
});
const CUSTOM = rule(6, { text: "Never book calls back to back", kind: "custom" });

/** True when the span, in Athens winter time, falls under the instruction. */
const hit = (i: Instruction, from: string, to: string) => protectedBy([i], T(from), T(to)).length === 1;
/** The same for spans written as instants. */
const hitAt = (i: Instruction, from: string, to: string, zone = "Europe/Athens") =>
  protectedBy([i], from, to, zone).length === 1;

test("clear_day: the whole local day, and midnight is the edge", () => {
  // Sunday 15 November 2026.
  assert.equal(hit(SUNDAYS, "2026-11-15 10:00", "2026-11-15 11:30"), true);
  assert.equal(hit(SUNDAYS, "2026-11-14 10:00", "2026-11-14 11:30"), false); // Saturday
  assert.equal(hit(SUNDAYS, "2026-11-16 10:00", "2026-11-16 11:30"), false); // Monday

  // Saturday night: a block that stops at Sunday 00:00 has not touched Sunday; one minute more has.
  assert.equal(hit(SUNDAYS, "2026-11-14 23:00", "2026-11-15 00:00"), false);
  assert.equal(hit(SUNDAYS, "2026-11-14 23:00", "2026-11-15 00:01"), true);
  // Sunday night: the last minute is Sunday, Monday 00:00 is not.
  assert.equal(hit(SUNDAYS, "2026-11-15 23:59", "2026-11-16 00:30"), true);
  assert.equal(hit(SUNDAYS, "2026-11-16 00:00", "2026-11-16 00:30"), false);

  // Local midnight, not UTC midnight. 22:30 UTC on Saturday is already Sunday 00:30 in Athens,
  // and 22:30 UTC on Sunday is Monday 00:30 in Athens.
  assert.equal(hitAt(SUNDAYS, "2026-11-14T22:30:00Z", "2026-11-14T23:00:00Z"), true);
  assert.equal(hitAt(SUNDAYS, "2026-11-15T22:30:00Z", "2026-11-15T23:00:00Z"), false);
  // The same instants in London are a Saturday evening and a Sunday evening.
  assert.equal(hitAt(SUNDAYS, "2026-11-14T22:30:00Z", "2026-11-14T23:00:00Z", "Europe/London"), false);
  assert.equal(hitAt(SUNDAYS, "2026-11-15T22:30:00Z", "2026-11-15T23:00:00Z", "Europe/London"), true);

  // Several days, and a span that covers a whole weekend.
  const weekend = rule(7, { text: "Weekends are free", kind: "clear_day", days: [6, 0] });
  assert.equal(hit(weekend, "2026-11-14 12:00", "2026-11-14 13:00"), true);
  assert.equal(hit(weekend, "2026-11-13 12:00", "2026-11-13 13:00"), false);
  assert.equal(hit(SUNDAYS, "2026-11-13 12:00", "2026-11-17 12:00"), true);
});

test("clear_day on the days the clocks change: Sunday is 25 hours long in October, 23 in March", () => {
  const zone = new Zone("Europe/Athens");
  // Sunday 25 October 2026: 00:00 is still summer time (21:00 UTC on Saturday), the day ends at
  // 00:00 winter time (22:00 UTC on Sunday).
  assert.deepEqual(protectedWindow(SUNDAYS, "2026-10-25", zone), {
    start: Date.parse("2026-10-24T21:00:00Z"),
    end: Date.parse("2026-10-25T22:00:00Z"),
  });
  assert.equal(hitAt(SUNDAYS, "2026-10-24T20:00:00Z", "2026-10-24T21:00:00Z"), false); // Saturday 23:00 to 24:00
  assert.equal(hitAt(SUNDAYS, "2026-10-24T21:00:00Z", "2026-10-24T21:30:00Z"), true); // Sunday 00:00
  // The hour that happens twice (03:00 to 04:00) is Sunday both times.
  assert.equal(hitAt(SUNDAYS, "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"), true);
  // 21:30 UTC is Sunday 23:30 now that the clocks are back; a week earlier it was Monday 00:30.
  assert.equal(hitAt(SUNDAYS, "2026-10-25T21:30:00Z", "2026-10-25T22:00:00Z"), true);
  assert.equal(hitAt(SUNDAYS, "2026-10-25T22:00:00Z", "2026-10-25T22:30:00Z"), false);
  assert.equal(hitAt(SUNDAYS, "2026-10-18T21:30:00Z", "2026-10-18T22:00:00Z"), false);

  // Sunday 29 March 2026: starts at 22:00 UTC on Saturday, ends 23 hours later at 21:00 UTC.
  assert.deepEqual(protectedWindow(SUNDAYS, "2026-03-29", zone), {
    start: Date.parse("2026-03-28T22:00:00Z"),
    end: Date.parse("2026-03-29T21:00:00Z"),
  });
  assert.equal(hitAt(SUNDAYS, "2026-03-29T20:30:00Z", "2026-03-29T21:00:00Z"), true); // Sunday 23:30
  assert.equal(hitAt(SUNDAYS, "2026-03-29T21:00:00Z", "2026-03-29T21:30:00Z"), false); // Monday 00:00
});

test("home_by: everything after the time until the day ends, on its days or every day", () => {
  assert.equal(hit(HOME, "2026-11-10 20:00", "2026-11-10 21:00"), false); // ends on the dot
  assert.equal(hit(HOME, "2026-11-10 20:00", "2026-11-10 21:01"), true);
  assert.equal(hit(HOME, "2026-11-10 22:00", "2026-11-10 23:00"), true);
  assert.equal(hit(HOME, "2026-11-15 22:00", "2026-11-15 23:00"), true); // every day, Sunday too
  assert.equal(hit(HOME, "2026-11-10 09:00", "2026-11-10 10:00"), false);
  // The small hours belong to the next day: not covered (quiet_hours is the tool for that).
  assert.equal(hit(HOME, "2026-11-11 00:30", "2026-11-11 01:30"), false);
  // A block from the evening into the night is caught by its evening part.
  assert.equal(hit(HOME, "2026-11-10 20:30", "2026-11-11 01:00"), true);

  // Only on its days: Tuesday yes, Saturday no.
  assert.equal(hit(HOME_WEEKDAYS, "2026-11-10 19:00", "2026-11-10 20:00"), true);
  assert.equal(hit(HOME_WEEKDAYS, "2026-11-14 19:00", "2026-11-14 20:00"), false);

  // The clock change: 21:00 is 18:00 UTC on Saturday 24 October and 19:00 UTC on Sunday 25.
  assert.equal(hitAt(HOME, "2026-10-24T18:00:00Z", "2026-10-24T18:30:00Z"), true);
  assert.equal(hitAt(HOME, "2026-10-25T18:00:00Z", "2026-10-25T19:00:00Z"), false);
  assert.equal(hitAt(HOME, "2026-10-25T19:00:00Z", "2026-10-25T19:30:00Z"), true);
});

test("quiet_hours: between the two times, past midnight when the end is not after the start", () => {
  assert.equal(hit(QUIET, "2026-11-10 21:00", "2026-11-10 22:00"), false);
  assert.equal(hit(QUIET, "2026-11-10 21:30", "2026-11-10 22:30"), true);
  assert.equal(hit(QUIET, "2026-11-11 02:00", "2026-11-11 03:00"), true); // started the evening before
  assert.equal(hit(QUIET, "2026-11-11 06:30", "2026-11-11 07:30"), true);
  assert.equal(hit(QUIET, "2026-11-11 07:00", "2026-11-11 08:00"), false);
  assert.equal(hit(QUIET, "2026-11-11 12:00", "2026-11-11 13:00"), false);

  // Inside one day, on weekdays only.
  assert.equal(hit(LUNCH, "2026-11-10 13:30", "2026-11-10 14:30"), true);
  assert.equal(hit(LUNCH, "2026-11-10 14:00", "2026-11-10 15:00"), false);
  assert.equal(hit(LUNCH, "2026-11-14 13:30", "2026-11-14 14:30"), false); // Saturday

  // A night window belongs to the day it starts on: Friday night reaches into Saturday morning,
  // and there is none on Saturday night.
  const fridayNight = { ...QUIET, days: [5] };
  assert.equal(hit(fridayNight, "2026-11-14 02:00", "2026-11-14 03:00"), true);
  assert.equal(hit(fridayNight, "2026-11-14 23:00", "2026-11-14 23:30"), false);
  assert.equal(hit(fridayNight, "2026-11-15 02:00", "2026-11-15 03:00"), false);

  // Through the spring change: Saturday 22:00 (20:00 UTC) to Sunday 07:00 summer time (04:00 UTC).
  assert.equal(hitAt(QUIET, "2026-03-29T03:30:00Z", "2026-03-29T04:30:00Z"), true);
  assert.equal(hitAt(QUIET, "2026-03-29T04:00:00Z", "2026-03-29T05:00:00Z"), false);
});

test("custom, paused and incomplete instructions protect nothing; several can apply at once", () => {
  assert.equal(hit(CUSTOM, "2026-11-15 10:00", "2026-11-15 11:00"), false);
  assert.equal(hit({ ...SUNDAYS, active: false }, "2026-11-15 10:00", "2026-11-15 11:00"), false);
  // Rows that lost what their kind needs: no days, no time, no end.
  const { days: _days, ...noDays } = SUNDAYS;
  const { time: _time, ...noTime } = HOME;
  const { end_time: _end, ...noEnd } = QUIET;
  for (const broken of [noDays, noTime, noEnd]) {
    assert.equal(hit(broken, "2026-11-15 22:30", "2026-11-15 23:00"), false);
  }

  // Sunday at 22:30: the clear day, the curfew and the quiet hours all apply, in the order given.
  const all = [CUSTOM, QUIET, SUNDAYS, HOME_WEEKDAYS, HOME, LUNCH];
  assert.deepEqual(
    protectedBy(all, T("2026-11-15 22:30"), T("2026-11-15 23:00")).map((i) => i.text),
    ["Nothing between 22:00 and 07:00", "Keep Sundays clear", "Home every day by 21:00"],
  );
  assert.deepEqual(protectedBy(all, T("2026-11-11 10:00"), T("2026-11-11 11:00")), []);
  assert.deepEqual(protectedBy([], T("2026-11-15 10:00"), T("2026-11-15 11:00")), []);

  // Instants as ms, and a span with no length reads as that instant.
  const noon = Date.parse(T("2026-11-15 12:00"));
  assert.equal(protectedBy([SUNDAYS], noon, noon).length, 1);
  assert.equal(
    protectedBy([SUNDAYS], Date.parse(T("2026-11-16 00:00")), Date.parse(T("2026-11-16 00:00"))).length,
    0,
  );
  assert.throws(() => protectedBy([SUNDAYS], "soon", "later"), RangeError);
});
