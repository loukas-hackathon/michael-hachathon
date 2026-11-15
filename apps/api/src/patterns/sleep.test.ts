import assert from "node:assert/strict";
import { test } from "node:test";
import { lastNight } from "../checkin/questions";
import { nightBefore } from "../recovery/plan";
import { buildContext } from "./context";
import { napIn } from "./sleep";
import { sleep, T } from "./testkit";
import { Zone } from "./time";

// The nap rule everywhere the API reads sleep. Athens winter time; every time is made up.
const zone = new Zone("Europe/Athens");
const ms = (local: string) => Date.parse(T(local));

test("napIn: under 3 hours, starting 09:00 to 20:00 local time", () => {
  assert.equal(napIn(zone, ms("2026-11-11 15:10"), ms("2026-11-11 15:35")), true);
  assert.equal(napIn(zone, ms("2026-11-11 09:00"), ms("2026-11-11 11:59")), true);
  // Three hours is a sleep, not a nap; 20:00 and 05:00 are nights however short.
  assert.equal(napIn(zone, ms("2026-11-11 13:00"), ms("2026-11-11 16:00")), false);
  assert.equal(napIn(zone, ms("2026-11-11 20:00"), ms("2026-11-11 21:00")), false);
  assert.equal(napIn(zone, ms("2026-11-11 05:00"), ms("2026-11-11 06:30")), false);
  assert.equal(napIn(zone, ms("2026-11-11 08:59"), ms("2026-11-11 09:30")), false);
});

test("check in: last night leaves a morning nap out", () => {
  const events = [
    sleep(T("2026-11-11 00:40"), T("2026-11-11 07:10")),
    sleep(T("2026-11-11 10:00"), T("2026-11-11 10:45")),
  ];
  assert.equal(lastNight({ now: ms("2026-11-11 14:00"), zone, events, goals: [] }), 390);
  assert.equal(lastNight({ now: ms("2026-11-11 14:00"), zone, events: events.slice(1), goals: [] }), null);
});

test("recovery: the night before a block is never a nap", () => {
  const block = { start: ms("2026-11-11 17:00"), end: ms("2026-11-11 18:00") };
  const night = sleep(T("2026-11-11 01:00"), T("2026-11-11 07:00"));
  const nap = sleep(T("2026-11-11 14:00"), T("2026-11-11 14:30"));
  assert.equal(nightBefore(block, [night, nap], zone), 360);
  assert.equal(nightBefore(block, [nap], zone), null);
});

test("patterns: naps stay sleep (not waking time) but are marked, so the bedtime ignores them", () => {
  const ctx = buildContext(
    [
      sleep(T("2026-11-11 00:40"), T("2026-11-11 07:10")),
      sleep(T("2026-11-11 15:00"), T("2026-11-11 15:30")),
    ],
    { from: T("2026-11-11 00:00"), to: T("2026-11-12 00:00"), now: T("2026-11-11 23:00") },
  );
  assert.deepEqual(
    ctx.sleeps.map((s) => s.nap),
    [false, true],
  );
});
