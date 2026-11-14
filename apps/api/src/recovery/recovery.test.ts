import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  type Event,
  type Goal,
  type Instruction,
  type Recommendation,
  type ScoreBlock,
  voiceProblems,
} from "@michael/shared";
import { runAsUser } from "../context";
import { withoutInstructions } from "../instructions/testkit";
import { decide, type EngineInput } from "../nudges/engine";
import { APPS, calendar, mac, phone, sleep, T } from "../patterns/testkit";
import { Zone } from "../patterns/time";
import { buildScore } from "../score/score";
import { store } from "../store";
import { recoveryKey, recoveryOffer } from "./offer";
import { planRecovery, type RecoveryInput, recoveryCause } from "./plan";

// Thursday 12 November 2026, Athens winter time. Every app, title and time is made up.
const DAY = "2026-11-12";
const at = (time: string) => T(`${DAY} ${time}`);
const zone = new Zone("Europe/Athens");

const goal = (id: string, category: Goal["category"], title: string, titles: string[]): Goal => ({
  id,
  category,
  title,
  description: null,
  target: { calendar_titles: titles, work_categories: ["communication"] },
  weekly_budget_minutes: 480,
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});
const COMPANY = goal("00000000-0000-4000-8000-0000000001a1", "business", "The company", ["Sales"]);
const TRAINING = goal("00000000-0000-4000-8000-0000000001a2", "health", "70.3", ["Gym", "Swimming"]);
const GOALS = [COMPANY, TRAINING];

const sales = () => calendar("Sales", at("10:30"), at("12:00"));
const meeting = (start: string, end: string) =>
  calendar("Call", at(start), at(end), { attendees: 2, with_others: true });

/** 60 minutes of Instagram on the Mac: one long stay, so no switching. */
const macScroll = () => mac(APPS.social, at("10:30"), at("11:30"));

const input = (now: string, events: Event[], extra: Partial<RecoveryInput> = {}): RecoveryInput => ({
  now: at(now),
  events,
  goals: GOALS,
  instructions: [],
  quiet: { start: "22:00", end: "07:00" },
  recommendations: [],
  ...extra,
});

const instruction = (i: Partial<Instruction> & Pick<Instruction, "kind">): Instruction => ({
  id: randomUUID(),
  text: "A rule",
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...i,
});

const lineOf = (now: string, events: Event[], extra: Partial<RecoveryInput> = {}) =>
  planRecovery(input(now, events, extra))?.recommendation.title ?? null;

test("a meeting overrun: 'Meetings ate the block.' and the first slot after the meeting", () => {
  // The call ran from 11:00 to 12:30; mail and scrolling ate the rest of the block.
  const events = [sales(), meeting("11:00", "12:30"), macScroll()];
  const offer = planRecovery(input("12:05", events));
  assert.ok(offer);
  assert.equal(offer.cause, "meeting");
  assert.equal(offer.recommendation.title, "Meetings ate the block. Take 25 minutes at 12:30. Still counts.");
  assert.equal(offer.recommendation.goal_id, COMPANY.id);
  const { action } = offer.recommendation;
  assert.equal(action.kind, "create_focus_block");
  assert.equal(action.involves_others, false);
  assert.equal(action.payload.start_at, new Date(Date.parse(at("12:30"))).toISOString());
  assert.equal(action.payload.end_at, new Date(Date.parse(at("12:55"))).toISOString());
  assert.equal(action.payload.title, "The company: 25 minutes");
  assert.equal(action.payload.recovery_for, offer.block.event_id);
  assert.equal(action.undo_until, action.payload.start_at);
  assert.match(offer.recommendation.rationale, /^Sales, 10:30 to 12:00: 30 minutes of 90 minutes spent; /);
});

test("each cause gives its line, in the rule's order", () => {
  // The phone, named by the score.
  assert.equal(
    lineOf("12:05", [sales(), phone(APPS.social, at("10:30"), at("11:40"))]),
    "Instagram took it. Take 25 minutes at 12:20. Still counts.",
  );
  // Many switches: half a minute each between Instagram and the editor, on the Mac.
  const flicker: Event[] = [];
  for (let m = 0; m < 70; m++) {
    const t = Date.parse(at("10:30")) + m * 60_000;
    flicker.push(mac(APPS.social, new Date(t).toISOString(), new Date(t + 40_000).toISOString()));
    flicker.push(mac(APPS.editor, new Date(t + 40_000).toISOString(), new Date(t + 60_000).toISOString()));
  }
  assert.equal(
    lineOf("12:05", [sales(), ...flicker]),
    "Too many switches. Take 25 minutes at 12:20. Still counts.",
  );
  // A short night: 5 hours, then an hour of scrolling with no switching.
  assert.equal(
    lineOf("12:05", [sales(), macScroll(), sleep(at("02:00"), at("07:00"))]),
    "Short night. Take 25 minutes at 12:20. Still counts.",
  );
  // A full night and nothing else: no single cause.
  assert.equal(
    lineOf("12:05", [sales(), macScroll(), sleep(T("2026-11-11 23:00"), at("07:00"))]),
    "The block slipped. Take 25 minutes at 12:20. Still counts.",
  );
  // No sleep data at all is not a short night.
  assert.equal(
    lineOf("12:05", [sales(), macScroll()]),
    "The block slipped. Take 25 minutes at 12:20. Still counts.",
  );
  // A meeting beats the phone.
  assert.match(
    lineOf("12:05", [sales(), meeting("10:30", "11:00"), phone(APPS.social, at("11:00"), at("11:50"))]) ?? "",
    /^Meetings ate the block\./,
  );
});

test("the phone without an app name reads 'The phone took it.'", () => {
  const block: ScoreBlock = {
    event_id: "e1",
    goal_id: COMPANY.id,
    goal_title: COMPANY.title,
    title: "Sales",
    matched_by: "calendar_titles",
    start_at: at("10:30"),
    end_at: at("12:00"),
    record_id: null,
    planned_minutes: 90,
    elapsed_minutes: 90,
    spent_minutes: 30,
    lost_minutes: 60,
    ahead_minutes: 0,
    unverified_minutes: 0,
    score_pct: 33,
    ticks: [],
    lost: [
      {
        start_at: at("10:30"),
        end_at: at("11:20"),
        minutes: 50,
        what: "a social site",
        kind: "site",
        category: "social",
        device: "iphone",
      },
      {
        start_at: at("11:20"),
        end_at: at("11:30"),
        minutes: 10,
        what: "YouTube",
        kind: "app",
        category: "video",
        device: "mac",
      },
    ],
    instructions_broken: [],
  } as ScoreBlock;
  assert.equal(recoveryCause(block, [], zone).line, "The phone took it.");
});

test("every line is an offer in the voice: under 15 words, no dashes, never 'booked'", () => {
  const offers = [
    planRecovery(input("12:05", [sales(), meeting("11:00", "12:30"), macScroll()])),
    planRecovery(input("12:05", [sales(), phone(APPS.social, at("10:30"), at("11:40"))])),
    planRecovery(input("12:05", [sales(), macScroll(), sleep(at("02:00"), at("07:00"))])),
  ];
  for (const offer of offers) {
    assert.ok(offer);
    const { title, rationale } = offer.recommendation;
    assert.ok(title.split(/\s+/).length < 15, title);
    assert.deepEqual(voiceProblems(title), []);
    assert.deepEqual(voiceProblems(rationale), []);
    assert.doesNotMatch(title, /book|I've|I have/i);
  }
});

test("no slot left today: no offer", () => {
  // The gym block ends at 22:30: the earliest slot would start at 22:50, after 22:00.
  const gym = calendar("Gym", at("20:30"), at("22:30"));
  assert.equal(planRecovery(input("22:35", [gym, phone(APPS.social, at("20:30"), at("21:51"))])), null);
  // 21:40: 25 minutes from 21:55 would end after 22:00.
  const early = calendar("Gym", at("20:00"), at("21:30"));
  assert.equal(planRecovery(input("21:40", [early, phone(APPS.social, at("20:00"), at("21:00"))])), null);
});

test("a slot inside a standing instruction or quiet hours is skipped", () => {
  const events = [sales(), macScroll()];
  // A standing quiet hours instruction from 12:00 to 14:00 on Thursdays.
  const quiet = instruction({ kind: "quiet_hours", time: "12:00", end_time: "14:00", days: [4] });
  assert.match(lineOf("12:05", events, { instructions: [quiet] }) ?? "", /at 14:00\./);
  // Home by 13:00 that day: nothing fits after 13:00, and 12:20 to 12:45 still does.
  const home = instruction({ kind: "home_by", time: "13:00" });
  assert.match(lineOf("12:05", events, { instructions: [home] }) ?? "", /at 12:20\./);
  const homeEarly = instruction({ kind: "home_by", time: "12:30" });
  assert.equal(lineOf("12:05", events, { instructions: [homeEarly] }), null);
  // The profile's quiet hours (here a long lunch, 12:00 to 15:30) are skipped too.
  assert.match(lineOf("12:05", events, { quiet: { start: "12:00", end: "15:30" } }) ?? "", /at 15:30\./);
  // Any other event is busy time.
  assert.match(lineOf("12:05", [...events, calendar("Lunch", at("12:15"), at("13:10"))]) ?? "", /at 13:10\./);
});

test("at most one offer per block, and one per goal a day", () => {
  const events = [sales(), macScroll()];
  const first = planRecovery(input("12:05", events));
  assert.ok(first);
  const stored: Pick<Recommendation, "goal_id" | "action" | "created_at"> = {
    goal_id: first.recommendation.goal_id,
    action: first.recommendation.action,
    created_at: at("12:05"),
  };
  // The next check, five minutes later: the block already has its offer.
  assert.equal(planRecovery(input("12:10", events, { recommendations: [stored] })), null);

  // A second business block slips in the afternoon: the goal already had its offer today.
  const afternoon = calendar("Sales", at("14:00"), at("15:00"));
  const later = [...events, afternoon, mac(APPS.social, at("14:00"), at("14:50"))];
  assert.equal(planRecovery(input("15:05", later, { recommendations: [stored] })), null);
  // An offer from yesterday does not count against today.
  const yesterday = {
    ...stored,
    action: { ...first.recommendation.action, payload: { recovery_for: "old" } },
  };
  assert.ok(
    planRecovery(
      input("15:05", later, { recommendations: [{ ...yesterday, created_at: T("2026-11-11 12:05") }] }),
    ),
  );
  // Another goal still gets its own.
  const gym = calendar("Gym", at("16:00"), at("17:00"));
  const offer = planRecovery(
    input("17:05", [...later, gym, phone(APPS.social, at("16:00"), at("16:45"))], {
      recommendations: [stored],
    }),
  );
  assert.equal(offer?.recommendation.goal_id, TRAINING.id);
  assert.equal(offer?.recommendation.action.payload.title, "70.3: 25 minutes");
});

test("an offer the guard refused still counts as the goal's offer for the day", () => {
  const events = [sales(), macScroll()];
  const first = planRecovery(input("12:05", events));
  assert.ok(first);
  // The guard strips the action and keeps the line.
  const refused = {
    goal_id: first.recommendation.goal_id,
    title: first.recommendation.title,
    action: null,
    created_at: at("12:05"),
  };
  assert.equal(planRecovery(input("12:10", events, { recommendations: [refused] })), null);
  // Other advice without an action does not block the offer.
  const advice = { ...refused, title: "Move the call to Friday." };
  assert.ok(planRecovery(input("12:10", events, { recommendations: [advice] })));
});

test("a block with other people in it gets none", () => {
  // A "Sales" call with a client is a meeting, never the user's own block.
  const call = calendar("Sales", at("10:30"), at("12:00"), { attendees: 1 });
  assert.equal(planRecovery(input("12:05", [call, macScroll()])), null);
  // Marked as with others, even with the number missing.
  const marked = calendar("Sales", at("10:30"), at("12:00"), { with_others: true });
  assert.equal(planRecovery(input("12:05", [marked, macScroll()])), null);
});

test("a block more than half spent gets none, and neither does one still running or long gone", () => {
  // 30 of 90 minutes lost: 60 spent.
  assert.equal(planRecovery(input("12:05", [sales(), mac(APPS.social, at("10:30"), at("11:00"))])), null);
  // Still running.
  assert.equal(planRecovery(input("11:55", [sales(), macScroll()])), null);
  // Ended more than two hours ago.
  assert.equal(planRecovery(input("14:30", [sales(), macScroll()])), null);
});

test("the accepted recovery block counts towards the goal in the score", () => {
  for (const [now, events, goalId] of [
    ["12:05", [sales(), macScroll()], COMPANY.id],
    [
      "17:05",
      [calendar("Gym", at("16:00"), at("17:00")), phone(APPS.social, at("16:00"), at("16:45"))],
      TRAINING.id,
    ],
  ] as const) {
    const offer = planRecovery(input(now, [...events]));
    assert.ok(offer);
    const p = offer.recommendation.action.payload;
    // What the executor writes on the timeline without Google (actions/calendar.ts).
    const block: Event = {
      id: randomUUID(),
      source: "agent",
      type: "calendar_event",
      start_at: String(p.start_at),
      end_at: String(p.end_at),
      title: String(p.title),
      data: { michael: true, with_others: false, attendees: 0, recommendation_id: randomUUID() },
      external_id: null,
      created_at: at("12:05"),
    };
    const score = buildScore([...events, block], GOALS, { date: DAY, now: at("23:00") });
    const counted = score.day.blocks.find((b) => b.event_id === block.id);
    assert.ok(counted, "the recovery block is a goal block");
    assert.equal(counted.goal_id, goalId);
    assert.equal(counted.spent_minutes, 25);
  }
});

test("the engine sends the offer as a nudge that counts towards the 5, while its slot is ahead", () => {
  const recovery = {
    recommendation_id: randomUUID(),
    goal_id: COMPANY.id,
    text: "Meetings ate the block. Take 25 minutes at 16:00. Still counts.",
    reason: "Sales, 10:30 to 12:00: 30 minutes of 90 minutes spent.",
    start_at: at("16:00"),
  };
  // No goals, so no weekly gap competes with the offer.
  const base: EngineInput = { now: at("12:10"), goals: [], events: [], today: [], recovery };
  const d = decide(base);
  assert.equal(d.action, "send");
  if (d.action === "send") {
    assert.equal(d.candidate.kind, "recovery_block");
    assert.equal(d.candidate.key, recoveryKey(recovery.recommendation_id));
    assert.equal(d.candidate.recommendation_id, recovery.recommendation_id);
    assert.equal(d.candidate.text, recovery.text);
  }
  // Five already went out: held back like any other nudge.
  const five = [8, 9, 10, 11, 11.5].map((h, i) => ({
    key: `k${i}`,
    status: "sent" as const,
    created_at: new Date(Date.parse(at("08:00")) + (h - 8) * 3_600_000).toISOString(),
  }));
  assert.equal(decide({ ...base, today: five }).action, "suppress");
  // Once nudged, never again.
  const nudged = [
    { key: recoveryKey(recovery.recommendation_id), status: "sent" as const, created_at: at("11:00") },
  ];
  assert.deepEqual(decide({ ...base, today: nudged }), { action: "skip", skipped: "nothing_to_say" });
  // The slot has started: nothing to offer.
  assert.deepEqual(decide({ ...base, now: at("16:05") }), { action: "skip", skipped: "nothing_to_say" });
});

test("recoveryOffer stores one offer through the store and hands it to the engine once", async () => {
  await runAsUser(randomUUID(), async () => {
    await withoutInstructions(store);
    const check = {
      now: at("12:05"),
      events: [sales(), meeting("11:00", "12:30"), macScroll()],
      goals: GOALS,
      today: [] as { key: string }[],
      quiet: { start: "22:00", end: "07:00" },
    };
    const first = await recoveryOffer(check);
    assert.ok(first);
    assert.equal(first.text, "Meetings ate the block. Take 25 minutes at 12:30. Still counts.");
    const stored = await store.getRecommendation(first.recommendation_id);
    assert.equal(stored?.status, "proposed");
    assert.equal(stored?.action?.kind, "create_focus_block");

    // Five minutes on: no second offer, the same one still waits for its nudge.
    const again = await recoveryOffer({ ...check, now: at("12:10") });
    assert.equal(again?.recommendation_id, first.recommendation_id);
    const offers = (await store.listRecommendations()).filter((r) => r.action?.payload.recovery_for);
    assert.equal(offers.length, 1);
    // Nudged: nothing more to hand over.
    assert.equal(
      await recoveryOffer({
        ...check,
        now: at("12:15"),
        today: [{ key: recoveryKey(first.recommendation_id) }],
      }),
      undefined,
    );
    // Off the record: nothing at all.
    assert.equal(await recoveryOffer({ ...check, offTheRecord: true }), undefined);
  });
});
