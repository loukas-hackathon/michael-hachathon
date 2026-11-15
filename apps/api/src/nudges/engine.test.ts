import assert from "node:assert/strict";
import { test } from "node:test";
import {
  behindPaceMinutes,
  bookMinutes,
  type Event,
  type Goal,
  isBehindPace,
  type Nudge,
  paceDaysToGo,
  paceMinutes,
  paceShare,
  voiceProblems,
  voiceShortDuration,
} from "@michael/shared";
import { APPS, calendar, goal, mac, T } from "../patterns/testkit";
import { buildScore } from "../score";
import {
  behindGoals,
  candidates,
  DEFAULT_QUIET,
  decide,
  type EngineInput,
  isValidCopy,
  quietFromProfile,
  quietNow,
  shortDuration,
  testCandidate,
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
  // The goal's own name, never the category word "Gym" (#364).
  assert.equal(d.candidate.text, "70.3 training at 18:00. Wrap up in 12 min.");
  assert.match(d.candidate.reason, /block 18:00 to 19:00/);
});

test("half an hour before the night, screens on, the rest goal speaks", () => {
  const events = [mac(APPS.editor, at("21:30"), at("21:40"))];
  const d = decide(input("21:40", events, [REST]));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.kind, "wind_down");
  assert.equal(d.candidate.text, "Screens off by 22:00. Sleep is a goal too.");
  // Screen off: nothing to say.
  assert.deepEqual(decide(input("21:40", [], [REST])), { action: "skip", skipped: "nothing_to_say" });
});

test("behind on a weekly budget shows the maths, and names the goal by its title", () => {
  // Wednesday 12:00 is 2.5 of 7 days: the pace for 10h is 3h 34. One 60 minute block on Monday.
  const events = [calendar("Gym", T("2026-11-09 07:00"), T("2026-11-09 08:00"))];
  const d = decide(input("12:00", events, [GYM]));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.kind, "goal_behind");
  assert.equal(d.candidate.text, "70.3 training 2h 34 behind pace. Book 90 minutes today.");
  assert.equal(d.candidate.reason, "70.3 training: 1h of 10h done; the pace by now is 3h 34.");
});

test("behind with a block later today: keep it", () => {
  const events = [calendar("Gym", at("18:00"), at("19:00"))];
  const d = decide(input("12:00", events, [GYM]));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.text, "70.3 training 3h 34 behind pace. Keep the 18:00 block.");
});

test("on pace: nothing to say", () => {
  const events = [calendar("Gym", T("2026-11-09 07:00"), T("2026-11-09 10:30"))];
  assert.deepEqual(decide(input("12:00", events, [GYM])), { action: "skip", skipped: "nothing_to_say" });
});

test("the behind nudge quotes the score's spent minutes, not the planned ones (#330)", () => {
  // Four hours planned on Monday, three of them on Instagram: the score counts one hour spent.
  const events = [
    calendar("Deep work", T("2026-11-09 10:00"), T("2026-11-09 14:00")),
    mac(APPS.social, T("2026-11-09 10:00"), T("2026-11-09 13:00")),
    mac(APPS.editor, T("2026-11-09 13:00"), T("2026-11-09 14:00")),
  ];
  const now = at("12:00");
  const score = buildScore(events, [WORK], { date: DAY, now });
  const row = score.goals.find((g) => g.goal_id === WORK.id);
  assert.ok(row);
  assert.equal(row.planned_minutes, 240);
  assert.equal(row.spent_minutes, 60);

  // What the Goals screen shows from the same score: spent of budget, on pace by now, behind pace.
  const share = paceShare(score.week_start, score.day.now);
  const due = paceMinutes(row.budget_minutes, share);
  const gap = behindPaceMinutes(row.budget_minutes, row.spent_minutes, share);
  assert.ok(isBehindPace(row.budget_minutes, row.spent_minutes, share));
  const hm = voiceShortDuration;
  const book = bookMinutes(row.minutes_left, paceDaysToGo(share));

  const [c] = candidates({ now, goals: [WORK], events, today: [] }).filter((x) => x.kind === "goal_behind");
  assert.ok(c);
  assert.equal(c.text, `Ship the pitch ${hm(gap)} behind pace. Book ${book} minutes today.`);
  assert.equal(c.text, "Ship the pitch 2h 34 behind pace. Book 90 minutes today.");
  assert.equal(
    c.reason,
    `Ship the pitch: ${hm(row.spent_minutes)} of ${hm(row.budget_minutes)} done; the pace by now is ${hm(due)}.`,
  );
  assert.equal(c.reason, "Ship the pitch: 1h of 10h done; the pace by now is 3h 34.");
  assert.deepEqual(behindGoals({ now, goals: [WORK], events, today: [] }), [
    { goal: WORK, spent: 60, pace: due, gap },
  ]);
});

test("a workout outside every block is not goal time, as in the score", () => {
  const events = [workout(T("2026-11-09 07:00"), T("2026-11-09 08:00"))];
  const [c] = candidates(input("12:00", events, [GYM]));
  assert.equal(c?.reason, "70.3 training: 0 min of 10h done; the pace by now is 3h 34.");
});

test("the goal furthest behind as Goals ranks it goes first, and only goals in the time score", () => {
  // The small goal has spent none of its 2h; the big one a third of its pace. Sleep is a target.
  const small = {
    ...goal("personal", "00000000-0000-4000-8000-0000000000b1", "Guitar"),
    weekly_budget_minutes: 240,
  };
  const sleep = {
    ...goal("health", "00000000-0000-4000-8000-0000000000b2", "Sleep"),
    target: { kind: "target", sleep_hours: 8 },
    weekly_budget_minutes: 3360,
  };
  const events = [calendar("Gym", T("2026-11-09 07:00"), T("2026-11-09 08:00"))];
  const behind = behindGoals(input("12:00", events, [GYM, small, sleep]));
  assert.deepEqual(
    behind.map((b) => [b.goal.title, b.gap]),
    [
      ["Guitar", 86],
      ["70.3 training", 154],
    ],
  );
});

test("a long or dashed goal title still makes a nudge that passes the voice rules", () => {
  const long = goal(
    "business",
    "00000000-0000-4000-8000-0000000000b3",
    "Deep work - the investor deck for the Monday pitch in Athens!",
  );
  const [c] = candidates(input("12:00", [], [long]));
  assert.ok(c);
  assert.equal(c.text, "Deep work the investor deck 3h 34 behind pace. Book 90 minutes today.");
  assert.ok(isValidCopy(c.text));
  assert.deepEqual(voiceProblems(c.text), []);
  assert.ok(wordCount(c.text) < 15);
  // The reason keeps the title as the user wrote it.
  assert.match(c.reason, /^Deep work - the investor deck for the Monday pitch in Athens!: 0 min of 10h done/);
});

test("the stage's test nudge speaks about the goal behind at any hour and from 15 minutes", () => {
  // Monday 11:05: 11h 05 of 168 hours gone, so the pace for 10h is 40 minutes. Nothing spent yet.
  const monday = (time: string, events: Event[], goals: Goal[]): EngineInput => ({
    now: T(`2026-11-09 ${time}`),
    goals,
    events,
    today: [],
  });
  assert.equal(candidates(monday("11:05", [], [GYM])).length, 0, "a real nudge keeps its thresholds");
  const c = testCandidate(monday("11:05", [], [GYM]));
  assert.equal(c?.kind, "goal_behind");
  assert.equal(c?.text, "70.3 training 40 min behind pace. Book 90 minutes today.");
  assert.equal(c?.reason, "70.3 training: 0 min of 10h done; the pace by now is 40 min.");
  assert.deepEqual(voiceProblems(c?.text ?? ""), []);

  // The same numbers as the score row and the shared pace rule.
  const now = T("2026-11-09 11:05");
  const score = buildScore([], [GYM], { date: "2026-11-09", now });
  const share = paceShare(score.week_start, score.day.now);
  const row = score.goals[0];
  assert.equal(behindPaceMinutes(row?.budget_minutes ?? 0, row?.spent_minutes ?? 0, share), 40);
  assert.equal(bookMinutes(row?.minutes_left ?? 0, paceDaysToGo(share)), 90);

  // After 19:00 too, where a real goal_behind is silent; a block still ahead today is kept.
  const behind = [calendar("Gym", T("2026-11-09 07:00"), T("2026-11-09 08:00"))];
  assert.equal(candidates(input("20:30", behind, [GYM])).length, 0);
  assert.equal(
    testCandidate(input("20:30", behind, [GYM]))?.text,
    "70.3 training 3h 05 behind pace. Book 90 minutes today.",
  );
  assert.equal(
    testCandidate(monday("11:05", [calendar("Gym", T("2026-11-09 18:00"), T("2026-11-09 19:00"))], [GYM]))
      ?.text,
    "70.3 training 40 min behind pace. Keep the 18:00 block.",
  );

  // Under 15 minutes behind, or on pace: nothing, so the route falls back to its sample line.
  assert.equal(testCandidate(monday("03:00", [], [GYM])), null);
  const onPace = [calendar("Gym", T("2026-11-09 07:00"), T("2026-11-09 12:00"))];
  assert.equal(testCandidate(input("20:30", onPace, [GYM])), null);
  // Never a target goal such as sleep, however far "behind" its budget looks.
  const sleep = {
    ...goal("health", "00000000-0000-4000-8000-0000000000c1", "Sleep"),
    target: { kind: "target", sleep_hours: 8 },
    weekly_budget_minutes: 3360,
  };
  assert.equal(testCandidate(monday("11:05", [], [sleep])), null);
  // A better candidate still wins: the block about to start.
  const soon = [calendar("Gym", T("2026-11-09 11:15"), T("2026-11-09 12:15"))];
  assert.equal(testCandidate(monday("11:05", soon, [GYM]))?.kind, "block_soon");
});

test("never in the night or at dinner", () => {
  // A rest goal that is not sleep: it is measured in time, so it owns the late block. (A sleep goal
  // is a target and has no blocks.)
  const evenings = goal("rest", "00000000-0000-4000-8000-0000000000a4", "Evenings off");
  const late = [calendar("Rest: read", at("22:45"), at("23:30"))];
  assert.deepEqual(decide(input("22:33", late, [evenings])), { action: "skip", skipped: "quiet_hours" });
  assert.deepEqual(decide(input("22:33", late, [REST])), { action: "skip", skipped: "nothing_to_say" });
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

test("test nudges (the stage moment) never count, block or delay a real one", () => {
  const tests = ["08:00", "09:00", "10:00", "11:00", "11:55"].map((t) => ({
    ...sent(t, "goal_behind"),
    status: "test" as const,
  }));
  assert.equal(decide(input("12:00", [], [GYM], tests)).action, "send");
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
