import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, Goal, Nudge } from "@michael/shared";
import { computeMoment } from "../moments/compute";
import { momentNudge } from "../moments/nudge";
import { calendar, goal, sleep, T } from "../patterns/testkit";
import { quietFrom } from "../routes/nudges";
import { DEFAULT_QUIET, decide, type EngineInput, isValidCopy, momentDue } from "./engine";

// Wednesday 11 November 2026, Athens winter time. Every time is made up.
const DAY = "2026-11-11";
const at = (time: string, day = DAY) => T(`${day} ${time}`);
const WORK = {
  ...goal("work", "00000000-0000-4000-8000-0000000000b1", "Ship the pitch"),
  weekly_budget_minutes: 600,
};
const goals: Goal[] = [WORK];

const LINE = { text: "Today holds 2h 00 of goal time.", reason: "Today holds 120 minutes of goal time." };

const input = (
  now: string,
  events: Event[] = [],
  today: EngineInput["today"] = [],
  extra: Partial<EngineInput> = {},
): EngineInput => ({ now: at(now), goals, events, today, ...extra });

const sent = (time: string, key: string): Pick<Nudge, "key" | "status" | "created_at"> => ({
  key,
  status: "sent",
  created_at: at(time),
});

/** Three nights in bed at 00:30, for a usual bedtime of 00:30. */
const lateNights = ["2026-11-08", "2026-11-09", "2026-11-10"].map((d) => {
  const next = `2026-11-${String(Number(d.slice(-2)) + 1).padStart(2, "0")}`;
  return sleep(at("00:30", next), at("08:00", next));
});

test("morning is due after the night's sleep ends, else from 08:00, and not after 12:00", () => {
  const woke = [sleep(at("23:30", "2026-11-10"), at("06:40"))];
  assert.equal(momentDue(input("06:30", woke)), null);
  assert.equal(momentDue(input("06:45", woke)), "morning");
  assert.equal(momentDue(input("07:50")), null);
  assert.equal(momentDue(input("08:00")), "morning");
  assert.equal(momentDue(input("12:30")), null);
  // A nap is not the night's sleep.
  assert.equal(momentDue(input("07:00", [sleep(at("05:00"), at("06:30"))])), null);
});

test("evening is due an hour before the usual bedtime, else 21:00, always before quiet hours", () => {
  assert.equal(momentDue(input("20:55")), null);
  assert.equal(momentDue(input("21:00")), "evening");
  // Bedtime 00:30 would mean 23:30, but quiet hours start at 22:00: 21:15 at the latest.
  assert.equal(momentDue(input("21:10", lateNights)), null);
  assert.equal(momentDue(input("21:15", lateNights)), "evening");
  // Early sleeper: in bed at 22:00 on 3 nights, so 21:00 is already late; 20:15 with quiet at 23:00.
  const early = ["08", "09", "10"].map((d) =>
    sleep(at("21:15", `2026-11-${d}`), at("06:00", `2026-11-${Number(d) + 1}`.replace(/-(\d)$/, "-0$1"))),
  );
  const quiet = { quiet: { ...DEFAULT_QUIET, nightStart: 23 * 60 } };
  assert.equal(momentDue(input("20:10", early, [], quiet)), null);
  assert.equal(momentDue(input("20:15", early, [], quiet)), "evening");
});

test("the moment goes out once a day, counts toward the 5 and respects quiet hours", () => {
  // No budget, so no weekly gap competes with the moment.
  const g = { goals: [{ ...WORK, weekly_budget_minutes: null }] };
  const moment = { kind: "morning" as const, ...LINE };
  const d = decide(input("08:05", [], [], { ...g, moment }));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.kind, "morning");
  assert.equal(d.candidate.key, "morning");
  assert.equal(d.candidate.text, LINE.text);
  assert.match(d.candidate.reason, /Sent at 08:00: no sleep recorded this morning\./);

  // Already out today: nothing to say.
  assert.deepEqual(decide(input("09:00", [], [sent("08:05", "morning")], { ...g, moment })), {
    action: "skip",
    skipped: "nothing_to_say",
  });
  // Five out already: stored as suppressed, never sent.
  const five = ["07:00", "07:30", "08:00", "08:30", "09:00"].map((t, i) => sent(t, `k${i}`));
  assert.equal(decide(input("10:00", [], five, { ...g, moment })).action, "suppress");
  // Inside a work block it waits.
  const block = [calendar("Deep work", at("08:00"), at("10:00"))];
  assert.deepEqual(decide(input("08:30", block, [], { ...g, moment })), {
    action: "skip",
    skipped: "quiet_hours",
  });
  // Evening during the night's quiet hours waits too.
  const evening = { kind: "evening" as const, ...LINE };
  assert.deepEqual(decide(input("22:30", [], [], { ...g, moment: evening })), {
    action: "skip",
    skipped: "quiet_hours",
  });
});

test("quiet hours come from the profile", () => {
  const q = quietFrom({ quiet_hours: { start: "23:15", end: "06:30" } });
  assert.equal(q.nightStart, 23 * 60 + 15);
  assert.equal(q.nightEnd, 6 * 60 + 30);
  assert.deepEqual(q.dinner, DEFAULT_QUIET.dinner);
});

test("the moment's nudge line is under 15 words with no dashes", () => {
  const events = [
    calendar("Deep work: pitch", at("10:00"), at("12:00")),
    calendar("Deep work: tests", at("09:00", "2026-11-12"), at("10:30", "2026-11-12")),
  ];
  for (const [kind, time] of [
    ["morning", "07:30"],
    ["evening", "21:00"],
  ] as const) {
    const m = computeMoment({ kind, events, goals, now: at(time) });
    const n = momentNudge(m);
    assert.ok(isValidCopy(n.text), n.text);
    assert.ok(n.reason.length > 0);
  }
  const morning = momentNudge(computeMoment({ kind: "morning", events, goals, now: at("07:30") }));
  assert.equal(morning.text, "Today holds 2h 00 of goal time.");
  const empty = momentNudge(computeMoment({ kind: "evening", events: [], goals: [], now: at("21:00") }));
  assert.equal(empty.text, "No goal time booked today. Book tomorrow before you sleep.");
});
