import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, Goal, Nudge } from "@michael/shared";
import { APPS, calendar, goal, mac, T } from "../patterns/testkit";
import {
  candidates,
  DEFAULT_QUIET,
  decide,
  type EngineInput,
  isValidCopy,
  quietFromProfile,
  quietNow,
  shortDuration,
  wordCount,
} from "./engine";

// Wednesday 11 November 2026, Athens winter time. Every app and time is made up.
const DAY = "2026-11-11";
const at = (time: string) => T(`${DAY} ${time}`);

const WORK = goal("work", "00000000-0000-4000-8000-0000000000a1", "Ship the pitch");
const GYM = goal("gym", "00000000-0000-4000-8000-0000000000a2", "70.3 training");
const REST = goal("rest", "00000000-0000-4000-8000-0000000000a3", "Sleep 8 hours");

const workout = (start: string, end: string): Event => ({
  id: crypto.randomUUID(),
  source: "health_auto_export",
  type: "workout",
  start_at: start,
  end_at: end,
  title: "Run",
  data: {},
  external_id: null,
  created_at: "2026-01-01T00:00:00Z",
});

const input = (
  now: string,
  events: Event[],
  goals: Goal[],
  today: EngineInput["today"] = [],
): EngineInput => ({
  now: at(now),
  goals,
  events,
  today,
});

const sent = (time: string, key = `k:${time}`): Pick<Nudge, "key" | "status" | "created_at"> => ({
  key,
  status: "sent",
  created_at: at(time),
});

const deepWork = calendar("Deep work", at("10:00"), at("12:00"));

test("drifting out of a focus block nudges back, even though deep work is quiet", () => {
  const events = [
    deepWork,
    mac(APPS.editor, at("10:00"), at("10:30")),
    mac(APPS.social, at("10:30"), at("10:36")),
  ];
  const d = decide(input("10:37", events, [WORK, GYM]));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.kind, "focus_drift");
  assert.equal(d.candidate.goal_id, WORK.id);
  assert.equal(d.candidate.text, "6 min on Instagram in your focus block. Back to it until 12:00.");
  assert.match(d.candidate.reason, /6 of the last 10 min/);
});

test("a focused block stays quiet, even when a goal is behind", () => {
  const events = [deepWork, mac(APPS.editor, at("10:00"), at("10:37"))];
  assert.ok(candidates(input("10:37", events, [WORK, GYM])).some((c) => c.kind === "goal_behind"));
  assert.deepEqual(decide(input("10:37", events, [WORK, GYM])), { action: "skip", skipped: "quiet_hours" });
});

test("a goal block about to start says when to wrap up", () => {
  const events = [calendar("Gym: legs", at("18:00"), at("19:00"))];
  const d = decide(input("17:48", events, [GYM]));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.kind, "block_soon");
  assert.equal(d.candidate.text, "Gym at 18:00. Wrap up in 12 min.");
  assert.match(d.candidate.reason, /block 18:00 to 19:00/);
});

test("half an hour before the night, screens on, the rest goal speaks", () => {
  const events = [mac(APPS.editor, at("21:30"), at("21:40"))];
  const d = decide(input("21:40", events, [REST]));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.kind, "wind_down");
  assert.equal(d.candidate.text, "Screens off by 22:00. Sleep is on the plan.");
  // Screen off: nothing to say.
  assert.deepEqual(decide(input("21:40", [], [REST])), { action: "skip", skipped: "nothing_to_say" });
});

test("behind on a weekly budget shows the maths", () => {
  // Wednesday 12:00 is 2.5 of 7 days: the pace for 10h is 3h 34. One 60 minute run on Monday.
  const events = [workout(T("2026-11-09 07:00"), T("2026-11-09 08:00"))];
  const d = decide(input("12:00", events, [GYM]));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.kind, "goal_behind");
  assert.equal(d.candidate.text, "Gym 2h 34 behind this week. Book 90 min today.");
  assert.equal(d.candidate.reason, "70.3 training: 1h of 10h done; the pace by now is 3h 34.");
});

test("behind with a block later today: keep it", () => {
  const events = [calendar("Gym", at("18:00"), at("19:00"))];
  const d = decide(input("12:00", events, [GYM]));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.text, "Gym 3h 34 behind this week. Keep the 18:00 block.");
});

test("on pace: nothing to say", () => {
  const events = [workout(T("2026-11-09 07:00"), T("2026-11-09 10:30"))];
  assert.deepEqual(decide(input("12:00", events, [GYM])), { action: "skip", skipped: "nothing_to_say" });
});

test("never in the night or at dinner", () => {
  const late = [calendar("Rest: read", at("22:45"), at("23:30"))];
  assert.deepEqual(decide(input("22:33", late, [REST])), { action: "skip", skipped: "quiet_hours" });
  const dinner = [calendar("Gym", at("20:40"), at("21:30"))];
  assert.deepEqual(decide(input("20:30", dinner, [GYM])), { action: "skip", skipped: "quiet_hours" });
});

test("the user's own quiet hours replace the default night, and bad ones fall back to 22:00 to 07:00", () => {
  const owl = quietFromProfile({ start: "23:30", end: "06:00" });
  assert.deepEqual([owl.nightStart, owl.nightEnd], [23 * 60 + 30, 6 * 60]);
  assert.equal(quietNow({ ...input("22:33", [], [REST]), quiet: owl }), null);
  assert.equal(quietNow({ ...input("23:45", [], [REST]), quiet: owl }), "night");
  assert.equal(quietNow({ ...input("05:50", [], [REST]), quiet: owl }), "night");
  assert.equal(quietNow({ ...input("06:10", [], [REST]), quiet: owl }), null);
  for (const bad of [null, undefined, { start: "25:00", end: "07:00" }, { start: "22:00", end: "22:00" }]) {
    assert.deepEqual(quietFromProfile(bad), DEFAULT_QUIET);
  }
});

test("at most 5 a day: the sixth is stored as suppressed", () => {
  const today = ["08:00", "09:00", "10:00", "11:00", "11:30"].map((t) => sent(t));
  const d = decide(input("12:00", [], [GYM], today));
  assert.equal(d.action, "suppress");
  // Suppressed ones do not count towards the cap.
  const withSuppressed = [...today.slice(0, 4), { ...sent("11:30"), status: "suppressed" as const }];
  assert.equal(decide(input("12:00", [], [GYM], withSuppressed)).action, "send");
});

test("no repeats, and at least 20 minutes apart", () => {
  assert.deepEqual(decide(input("12:00", [], [GYM], [sent("09:00", "goal_behind")])), {
    action: "skip",
    skipped: "nothing_to_say",
  });
  assert.deepEqual(decide(input("12:00", [], [GYM], [sent("11:50")])), {
    action: "skip",
    skipped: "too_soon",
  });
});

test("off the record stops everything", () => {
  assert.deepEqual(decide({ ...input("12:00", [], [GYM]), offTheRecord: true }), {
    action: "skip",
    skipped: "off_the_record",
  });
});

test("copy rules: under 15 words, no dashes", () => {
  assert.equal(wordCount("Gym at 18:00. Wrap up in 12 min."), 8);
  assert.ok(isValidCopy("Gym at 18:00. Wrap up in 12 min."));
  assert.ok(!isValidCopy("Gym now - go!"));
  assert.ok(
    !isValidCopy("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"),
  );
  assert.equal(shortDuration(45), "45 min");
  assert.equal(shortDuration(120), "2h");
  assert.equal(shortDuration(130), "2h 10");
});
