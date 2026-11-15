import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type Event, type Goal, Moment, voiceProblems } from "@michael/shared";
import { isValidCopy } from "../nudges/engine";
import { APPS, calendar, goal, mac, phone, sleep, T, web, workout } from "../patterns/testkit";
import { buildScore } from "../score/score";
import {
  computeMoment,
  freeSlot,
  lastTimeLine,
  type MomentCore,
  momentRange,
  slotLength,
  templateHeadline,
} from "./compute";
import { momentNudge } from "./nudge";
import { acceptable, cacheLineForTest, factsFor, lineFrom, phraseHeadline } from "./phrase";

// A made up week in Athens winter time. Wednesday 11 November 2026; the week began Monday 9th.
const W = "10000000-0000-4000-8000-00000000000a";
const G = "10000000-0000-4000-8000-00000000000b";
const R = "10000000-0000-4000-8000-00000000000c";
const U = "10000000-0000-4000-8000-00000000000d";
const goals: Goal[] = [
  { ...goal("work", W, "Deep work"), weekly_budget_minutes: 600 },
  { ...goal("gym", G, "Gym"), weekly_budget_minutes: 240 },
  { ...goal("rest", R, "Sleep"), weekly_budget_minutes: 3150 },
];

/** A two hour work block from 10:00 with `lost` minutes of Instagram on the Mac at 10:30. */
const workDay = (d: string, lost = 20, title = "Deep work"): Event[] => [
  calendar(title, T(`${d} 10:00`), T(`${d} 12:00`)),
  mac(APPS.editor, T(`${d} 10:00`), T(`${d} 10:30`)),
  ...(lost > 0 ? [mac(APPS.social, T(`${d} 10:30`), T(`${d} 10:${30 + lost}`))] : []),
  mac(APPS.editor, T(`${d} 10:${30 + lost}`), T(`${d} 12:00`)),
];

/** Last Friday, Monday and Tuesday: the same block, 20 minutes of Instagram in each. */
const history = (): Event[] => ["2026-11-06", "2026-11-09", "2026-11-10"].flatMap((d) => workDay(d));

const todayPlan = (): Event[] => [
  calendar("Deep work: pitch", T("2026-11-11 10:00"), T("2026-11-11 12:00")),
  calendar("Team sync", T("2026-11-11 13:00"), T("2026-11-11 14:00"), { attendees: 4 }),
  workout(T("2026-11-09 18:00"), T("2026-11-09 19:00"), "Run"),
  sleep(T("2026-11-10 23:00"), T("2026-11-11 07:00")),
];

const morning = (events: Event[], now = "2026-11-11 07:30", g = goals) =>
  computeMoment({ kind: "morning", events, goals: g, now: T(now) });
const evening = (events: Event[], now = "2026-11-11 21:00", g = goals) =>
  computeMoment({ kind: "evening", events, goals: g, now: T(now) });

test("momentRange covers what the score reads, and tomorrow when it is next week", () => {
  const r = momentRange(T("2026-11-11 07:30"));
  assert.equal(r.from, "2026-10-11T21:00:00.000Z"); // 28 days before Monday 9 Nov, Athens summer time
  assert.equal(r.to, "2026-11-15T22:00:00.000Z"); // Monday 16 Nov 00:00 Athens
  // On a Sunday tomorrow is next week: the range runs to the end of Monday.
  assert.equal(momentRange(T("2026-11-15 20:00")).to, "2026-11-16T22:00:00.000Z");
});

test("freeSlot and slotLength", () => {
  const at = (h: number) => h * 3600_000;
  const busy = [
    { start: at(10), end: at(12) },
    { start: at(13), end: at(14) },
  ];
  assert.deepEqual(freeSlot(busy, at(8), at(21), 60), { start: at(8), end: at(9) });
  assert.deepEqual(freeSlot(busy, at(9.5), at(21), 60), { start: at(12), end: at(13) });
  assert.deepEqual(freeSlot(busy, at(11), at(21), 90), { start: at(14), end: at(15.5) });
  assert.equal(freeSlot(busy, at(10), at(12), 30), null);
  assert.equal(slotLength(280, 5), 60);
  assert.equal(slotLength(20, 5), 30);
  assert.equal(slotLength(900, 2), 90);
});

test("morning: today against each budget, the block at risk and two moves", () => {
  const m = morning([...history(), ...todayPlan()]);
  const full = Moment.parse({ ...m, headline: templateHeadline(m), phrased_by: "template" });
  assert.equal(full.day, "2026-11-11");

  const work = m.goals.find((g) => g.goal_id === W);
  assert.deepEqual(work, {
    goal_id: W,
    title: "Deep work",
    category: "work",
    area: "business",
    kind: "time",
    budget_minutes: 600,
    sleep: false,
    spent_week_minutes: 200, // 2 x (120 planned less 20 lost)
    planned_today_minutes: 120,
    spent_today_minutes: 0,
    lost_today_minutes: 0,
    planned_ahead_minutes: 120,
    unplanned_minutes: 280, // 600 - 200 - 120
  });
  // A workout with no block is not planned goal time: the score counts blocks, and so does the moment.
  const gym = m.goals.find((g) => g.goal_id === G);
  assert.equal(gym?.spent_week_minutes, 0);
  assert.equal(gym?.unplanned_minutes, 240);
  const rest = m.goals.find((g) => g.goal_id === R);
  assert.equal(rest?.spent_today_minutes, 480);
  // The screens hide the sleep goal from time lines by this flag, not by category.
  assert.equal(rest?.sleep, true);
  assert.equal(rest?.area, "health");
  assert.equal(gym?.sleep, false);
  assert.equal(rest?.planned_today_minutes, 450);
  assert.equal(rest?.unplanned_minutes, null);

  assert.equal(m.totals.planned_minutes, 120);
  // The usual rate (60 lost of 360 planned) over today's 120 minutes: what today stands to lose.
  assert.equal(m.totals.baseline_lost_minutes, 20);
  assert.equal(m.totals.won_back_minutes, 0);

  assert.equal(m.at_risk?.title, "Deep work: pitch");
  assert.equal(m.at_risk?.goal_id, W);
  assert.equal(m.at_risk?.expected_lost_minutes, 20);
  assert.equal(m.at_risk?.history_days, 3);
  assert.equal(m.at_risk?.usual_trigger, "Instagram");
  // The same goal at the same hour yesterday: that is the block's last time.
  assert.deepEqual(m.at_risk?.last_time, { day: "2026-11-10", lost_minutes: 20, trigger: "Instagram" });

  assert.equal(m.suggestions.length, 2);
  assert.equal(m.suggestions[0]?.title, "Silence Instagram from 10:00 to 12:00");
  assert.equal(m.suggestions[0]?.action_kind, "block_mac_app");
  assert.equal(m.suggestions[0]?.rationale, "Yesterday this block lost 20 minutes to Instagram.");
  assert.equal(m.suggestions[1]?.title, "Book 60 minutes for Deep work at 08:00");
  assert.equal(m.suggestions[1]?.action_kind, "create_focus_block");
  assert.equal(
    m.suggestions[1]?.rationale,
    "6h 40 of 10h for Deep work left this week and 2h planned, so 4h 40 is not booked.",
  );
  assert.equal(m.lesson, null);
  assert.equal(m.first_move, null);
  assert.equal(
    templateHeadline(m),
    "Today holds 2h of goal time. Yesterday the 10:00 block lost 20 minutes to Instagram.",
  );
});

test("evening: plan against what happened, won back, one lesson, tomorrow's first move", () => {
  const today = [
    mac(APPS.editor, T("2026-11-11 10:00"), T("2026-11-11 10:55")),
    mac(APPS.social, T("2026-11-11 10:55"), T("2026-11-11 11:00")),
    mac(APPS.editor, T("2026-11-11 11:00"), T("2026-11-11 12:00")),
    calendar("Deep work: tests", T("2026-11-12 09:00"), T("2026-11-12 10:30")),
  ];
  const m = evening([...history(), ...todayPlan(), ...today]);
  Moment.parse({ ...m, headline: templateHeadline(m), phrased_by: "template" });

  assert.equal(m.goals.find((g) => g.goal_id === W)?.spent_today_minutes, 115);
  assert.equal(m.goals.find((g) => g.goal_id === W)?.lost_today_minutes, 5);
  assert.deepEqual(m.totals, {
    planned_minutes: 120,
    spent_minutes: 115,
    lost_minutes: 5,
    // The usual rate is 60 lost of 360 planned on the three days before: 20 of today's 120.
    baseline_lost_minutes: 20,
    won_back_minutes: 15,
  });
  assert.equal(m.at_risk, null);
  assert.deepEqual(m.suggestions, []);
  assert.equal(m.lesson, "Instagram cost 5 minutes in 1 interruption today.");
  assert.equal(m.first_move?.title, "Start Deep work: tests at 09:00");
  assert.equal(
    m.first_move?.rationale,
    "First goal block tomorrow: 90 minutes for Deep work. Put Instagram away before it starts.",
  );
  assert.equal(
    templateHeadline(m),
    "You held 115 minutes of 2h planned goal time. 5 minutes got away. 15 minutes won back against your usual day.",
  );
});

test("evening without a block tomorrow books the biggest gap", () => {
  const m = evening([...history(), ...todayPlan()]);
  assert.equal(m.first_move?.title, "Book 60 minutes for Deep work at 08:00 tomorrow");
  assert.equal(m.first_move?.start_at, "2026-11-12T06:00:00.000Z");
});

test("a new user with no data gets budgets and no invented risk", () => {
  const m = morning([]);
  assert.equal(m.at_risk, null);
  assert.equal(m.totals.baseline_lost_minutes, null);
  assert.equal(m.suggestions.length, 1);
  assert.equal(m.suggestions[0]?.goal_id, W);
  assert.equal(
    templateHeadline(m),
    "Nothing booked for your goals today. Book 90 minutes for Deep work at 08:00.",
  );
  const empty = computeMoment({ kind: "evening", events: [], goals: [], now: T("2026-11-11 21:00") });
  assert.equal(empty.lesson, "No goal blocks today. Time you do not book goes elsewhere.");
  assert.equal(empty.first_move, null);
  assert.equal(templateHeadline(empty), "No goal time today. Put tomorrow's in before bed.");
});

// ---------- row 1: the headline is a finished line or the template ----------

test("a model line is used only when it keeps the voice and invents no number", () => {
  const facts = factsFor(morning([...history(), ...todayPlan()]));
  assert.ok(
    acceptable("Two hours of goal time today. Guard 10:00 to 12:00, Instagram costs you 20 minutes.", facts),
  );
  assert.ok(!acceptable("Guard 10:00 to 12:00, it costs you 35 minutes.", facts));
  assert.ok(!acceptable("Big day ahead! Guard your block.", facts));
  assert.ok(!acceptable("Guard your block — it matters.", facts));
  assert.ok(!acceptable("Protect your productivity this morning.", facts));
});

test("a line that is not finished, or holds a semicolon, is refused", () => {
  const facts = factsFor(morning([...history(), ...todayPlan()]));
  // The two half lines seen on the stage account: both stop in the middle.
  assert.ok(!acceptable("Today holds 2 hours of goal time; guard Deep work from 10:00 to 12:", facts));
  assert.ok(!acceptable("Today holds 20", facts));
  assert.ok(!acceptable("Today holds 2 hours of goal time, guard 10:00 to 12:00", facts));
  // A finished line with a semicolon is refused too: Michael says one thing, then the next.
  assert.ok(!acceptable("Today holds 2 hours of goal time; guard 10:00 to 12:00.", facts));
  assert.ok(acceptable("Today holds 2 hours of goal time. Guard 10:00 to 12:00.", facts));
  assert.ok(acceptable("Instagram took 20 minutes of this block yesterday. Phone out of the room?", facts));
});

test("a reply cut by the token cap falls back to the template", async () => {
  const m = morning([...history(), ...todayPlan()]);
  const facts = factsFor(m);
  const template = { headline: templateHeadline(m), phrased_by: "template" };
  const text = (t: string) => [{ type: "text", text: t }];
  const good = "Two hours of goal time today. Guard 10:00 to 12:00.";

  // Only a reply the model ended by itself counts, even when the cut line looks whole.
  assert.equal(lineFrom({ stop_reason: "max_tokens", content: text(good) }, facts), null);
  assert.equal(lineFrom({ stop_reason: "refusal", content: text(good) }, facts), null);
  assert.equal(lineFrom({ stop_reason: "end_turn", content: text(good) }, facts), good);
  // Thinking blocks come first and carry no line.
  assert.equal(
    lineFrom({ stop_reason: "end_turn", content: [{ type: "thinking" }, ...text(`"${good}"`)] }, facts),
    good,
  );

  const cut = await phraseHeadline(m, "u:cut", async () => ({
    stop_reason: "max_tokens",
    content: text("Today holds 2 hours of goal time; guard Deep work from 10:00 to 12:"),
  }));
  assert.deepEqual(cut, template);
  const semicolon = await phraseHeadline(m, "u:semi", async () => ({
    stop_reason: "end_turn",
    content: text("Today holds 2 hours of goal time; guard 10:00 to 12:00."),
  }));
  assert.deepEqual(semicolon, template);
  const failed = await phraseHeadline(m, "u:down", async () => {
    throw new Error("model is down");
  });
  assert.deepEqual(failed, template);
  // No model at all (no key): the template.
  assert.deepEqual(await phraseHeadline(m, "u:none", null), template);

  // A finished line is used and cached: the second read does not ask again.
  let asked = 0;
  const ask = async () => {
    asked++;
    return { stop_reason: "end_turn", content: text(good) };
  };
  assert.deepEqual(await phraseHeadline(m, "u:ok", ask), { headline: good, phrased_by: "model" });
  assert.deepEqual(await phraseHeadline(m, "u:ok", ask), { headline: good, phrased_by: "model" });
  assert.equal(asked, 1);
});

test("a half line that was already cached is never served again", async () => {
  const m = morning([...history(), ...todayPlan()]);
  cacheLineForTest(m, "u:old", "Today holds 2 hours of goal time; guard Deep work from 10:00 to 12:");
  const good = "Two hours of goal time today. Guard 10:00 to 12:00.";
  const served = await phraseHeadline(m, "u:old", async () => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: good }],
  }));
  assert.deepEqual(served, { headline: good, phrased_by: "model" });
});

// ---------- row 4: most at risk ----------

const TRAIN = "10000000-0000-4000-8000-00000000000e";
const training: Goal = { ...goal("health", TRAIN, "70.3"), target: { calendar_titles: ["Rhefuel", "Run"] } };

test("a training block is never most at risk", () => {
  // Mail on the Mac during the recovery session, 20 minutes on each of three days.
  const session = (d: string): Event[] => [
    calendar("Rhefuel", T(`${d} 09:00`), T(`${d} 10:30`)),
    mac(APPS.browser, T(`${d} 09:10`), T(`${d} 09:30`)),
    web("mail.google.com", T(`${d} 09:10`), T(`${d} 09:30`)),
  ];
  const events = [
    ...["2026-11-06", "2026-11-09", "2026-11-10"].flatMap(session),
    calendar("Rhefuel", T("2026-11-11 09:00"), T("2026-11-11 10:30")),
  ];
  const all = [...goals, training];
  // The score does count the mail as lost inside the session.
  const score = buildScore(events, all, { date: "2026-11-10", now: T("2026-11-10 21:00") });
  assert.equal(score.day.blocks[0]?.lost_minutes, 20);

  const m = morning(events, "2026-11-11 07:30", all);
  assert.equal(m.totals.planned_minutes, 90);
  assert.equal(m.at_risk, null);
  // No line, so no move for it either: only the booking is left.
  assert.deepEqual(
    m.suggestions.map((s) => s.action_kind),
    ["create_focus_block"],
  );
  assert.equal(templateHeadline(m), "Today holds 90 minutes of goal time.");
  assert.equal(momentNudge(m).text, "Today holds 90 minutes of goal time.");
  // The stage shows the reason under the line: it never says the line twice (QA round 3).
  assert.ok(!momentNudge(m).reason.includes("Today holds 90 minutes"), momentNudge(m).reason);

  // A work block later the same day is the one at risk, not the session before it.
  const both = morning([...events, ...history(), ...todayPlan()], "2026-11-11 07:30", all);
  assert.equal(both.at_risk?.title, "Deep work: pitch");
});

test("under 10 minutes at stake says nothing", () => {
  const events = [
    ...["2026-11-06", "2026-11-09", "2026-11-10"].flatMap((d) => workDay(d, 9)),
    ...todayPlan(),
  ];
  const m = morning(events);
  assert.equal(m.at_risk, null);
  assert.deepEqual(
    m.suggestions.map((s) => s.action_kind),
    ["create_focus_block"],
  );
  assert.equal(templateHeadline(m), "Today holds 2h of goal time.");
  // Ten minutes is enough.
  const ten = morning([
    ...["2026-11-06", "2026-11-09", "2026-11-10"].flatMap((d) => workDay(d, 10)),
    ...todayPlan(),
  ]);
  assert.equal(ten.at_risk?.expected_lost_minutes, 10);
});

test("a well known site goes by its product name, and the move is the user's to make", () => {
  const day = (d: string): Event[] => [
    calendar("Deep work", T(`${d} 10:00`), T(`${d} 12:00`)),
    mac(APPS.browser, T(`${d} 10:00`), T(`${d} 12:00`)),
    web("mail.google.com", T(`${d} 10:30`), T(`${d} 10:50`)),
  ];
  const m = morning([...["2026-11-06", "2026-11-09", "2026-11-10"].flatMap(day), ...todayPlan()]);
  assert.equal(m.at_risk?.usual_trigger, "Gmail");
  assert.equal(m.at_risk?.last_time?.trigger, "Gmail");
  assert.equal(m.suggestions[0]?.title, "Keep Gmail closed from 10:00 to 12:00");
  // Michael can close a Mac app for a block. A site he cannot, so it is a reminder.
  assert.equal(m.suggestions[0]?.action_kind, "reminder");
  assert.equal(m.suggestions[0]?.rationale, "Yesterday this block lost 20 minutes to Gmail.");
  assert.doesNotMatch(JSON.stringify(m), /mail\.google\.com/);
});

test("a phone trigger means the phone leaves the room", () => {
  const day = (d: string): Event[] => [
    calendar("Deep work", T(`${d} 10:00`), T(`${d} 12:00`)),
    phone(APPS.social, T(`${d} 10:30`), T(`${d} 10:54`)),
  ];
  const m = morning([...["2026-11-09", "2026-11-10"].flatMap(day), ...todayPlan()]);
  assert.equal(m.suggestions[0]?.title, "Phone in another room from 10:00 to 12:00");
  assert.equal(m.suggestions[0]?.action_kind, "reminder");
  assert.equal(m.suggestions[0]?.rationale, "Yesterday this block lost 24 minutes to Instagram.");
});

// ---------- row 11: the stake ----------

const SALES = "10000000-0000-4000-8000-00000000000f";
const sales: Goal = { ...goal("business", SALES, "Sales"), target: { calendar_titles: ["Cold outreach"] } };

test("the stake is the average over the days that had a block in those hours", () => {
  // Two of the last seven days had a block from 10:00 to 12:00, and each lost 24 minutes.
  const outreach = (d: string): Event[] => [
    calendar("Cold outreach", T(`${d} 10:00`), T(`${d} 12:00`)),
    phone(APPS.social, T(`${d} 10:30`), T(`${d} 10:54`)),
  ];
  // Phone use outside any block on the other days must not thin the average, or add to it.
  const drift = ["2026-11-05", "2026-11-07", "2026-11-08", "2026-11-10"].map((d) =>
    phone(APPS.social, T(`${d} 10:30`), T(`${d} 11:30`)),
  );
  const events = [
    ...outreach("2026-11-06"),
    ...outreach("2026-11-09"),
    ...drift,
    calendar("Deep work: pitch", T("2026-11-11 10:00"), T("2026-11-11 12:00")),
  ];
  const m = morning(events, "2026-11-11 07:30", [...goals, sales]);
  // 48 minutes over 2 block days, not over 7 days (which would read 7 minutes).
  assert.equal(m.at_risk?.expected_lost_minutes, 24);
  assert.equal(m.at_risk?.history_days, 2);
  assert.equal(m.at_risk?.usual_trigger, "Instagram");
  // Another goal's block under another title: not this block's last time.
  assert.equal(m.at_risk?.last_time, null);
  assert.equal(
    templateHeadline(m),
    "Today holds 2h of goal time. Guard 10:00 to 12:00: it usually costs 24 minutes.",
  );
  assert.equal(
    m.suggestions[0]?.rationale,
    "Goal blocks in these hours usually lose 24 minutes, mostly to Instagram (2 days with a block in the last 7).",
  );
});

test("the same block's last time is quoted in place of the average", () => {
  const outreach = (d: string, lost: number): Event[] => [
    calendar("Cold outreach", T(`${d} 10:30`), T(`${d} 12:00`)),
    ...(lost > 0 ? [phone(APPS.social, T(`${d} 10:30`), T(`${d} 10:${30 + lost}`))] : []),
  ];
  const all = [...goals, sales];
  // Monday lost nothing, Tuesday (yesterday) lost 24 minutes.
  const events = [
    ...outreach("2026-11-09", 0),
    ...outreach("2026-11-10", 24),
    calendar("Cold outreach", T("2026-11-11 10:30"), T("2026-11-11 12:00")),
  ];
  const m = morning(events, "2026-11-11 07:30", all);
  assert.equal(m.at_risk?.expected_lost_minutes, 12);
  assert.deepEqual(m.at_risk?.last_time, { day: "2026-11-10", lost_minutes: 24, trigger: "Instagram" });
  const headline = templateHeadline(m);
  assert.equal(
    headline,
    "Today holds 90 minutes of goal time. Yesterday the 10:30 block lost 24 minutes to Instagram.",
  );
  assert.deepEqual(voiceProblems(headline), []);
  // The stake as a line of its own is a nudge: under 15 words.
  const stake = lastTimeLine(m.at_risk as NonNullable<MomentCore["at_risk"]>, m.day);
  assert.equal(stake, "Yesterday this block lost 24 minutes to Instagram.");
  assert.ok(isValidCopy(stake ?? ""));
  const nudge = momentNudge(m);
  assert.equal(nudge.text, "Yesterday the 10:30 block lost 24 minutes to Instagram.");
  assert.ok(isValidCopy(nudge.text), nudge.text);
  assert.ok(!nudge.reason.includes(nudge.text), nudge.reason);

  // Read while the block is running, the line says "this block" and guards what is left of it.
  const running = morning(events, "2026-11-11 10:47", all);
  assert.equal(
    running.at_risk?.start_at,
    T("2026-11-11 10:47").replace("+02:00", "").replace("T10:47:00", "T08:47:00.000Z"),
  );
  assert.equal(
    templateHeadline(running),
    "Today holds 90 minutes of goal time. Yesterday this block lost 24 minutes to Instagram.",
  );

  // Two days ago is named by its weekday.
  const friday = morning(
    [...outreach("2026-11-09", 24), calendar("Cold outreach", T("2026-11-11 10:30"), T("2026-11-11 12:00"))],
    "2026-11-11 07:30",
    all,
  );
  assert.equal(
    templateHeadline(friday),
    "Today holds 90 minutes of goal time. On Monday the 10:30 block lost 24 minutes to Instagram.",
  );
  // The last time lost nothing: no quote, and the average (12 minutes) still speaks.
  const calm = morning(
    [
      ...outreach("2026-11-09", 24),
      ...outreach("2026-11-10", 0),
      calendar("Cold outreach", T("2026-11-11 10:30"), T("2026-11-11 12:00")),
    ],
    "2026-11-11 07:30",
    all,
  );
  assert.equal(calm.at_risk?.last_time, null);
  assert.equal(
    templateHeadline(calm),
    "Today holds 90 minutes of goal time. Guard 10:30 to 12:00: it usually costs 12 minutes.",
  );
});

test("the user's own word is not a distraction: logged time and settled blocks stay out of the stake", () => {
  const all = [...goals, sales];
  const block = (d: string) => calendar("Cold outreach", T(`${d} 10:30`), T(`${d} 12:00`));
  const monday = block("2026-11-09");
  const tuesday = block("2026-11-10");
  const manual = (type: Event["type"], start: string, end: string, data: Record<string, unknown>): Event => ({
    id: randomUUID(),
    source: "manual",
    type,
    start_at: start,
    end_at: end,
    title: "Logged",
    data,
    external_id: null,
    created_at: end,
  });
  const events = [
    monday,
    phone(APPS.social, T("2026-11-09 10:30"), T("2026-11-09 10:54")),
    // Tuesday's block he settled himself as not done: all of it lost in the score, to nothing.
    tuesday,
    manual("note", tuesday.start_at, tuesday.end_at as string, {
      log: "didnt",
      goal_id: SALES,
      event_id: tuesday.id,
    }),
    // And he logged an hour of sales work on Sunday morning, outside any block.
    manual("focus_session", T("2026-11-08 10:30"), T("2026-11-08 11:30"), { log: "done", goal_id: SALES }),
    block("2026-11-11"),
  ];
  const score = buildScore(events, all, { date: "2026-11-10", now: T("2026-11-10 21:00") });
  assert.equal(score.day.lost_minutes, 90);

  const m = morning(events, "2026-11-11 07:30", all);
  // One day had a planned block he did not settle himself: Monday, 24 minutes to Instagram.
  assert.equal(m.at_risk?.history_days, 1);
  assert.equal(m.at_risk?.expected_lost_minutes, 24);
  assert.deepEqual(m.at_risk?.last_time, { day: "2026-11-09", lost_minutes: 24, trigger: "Instagram" });
  assert.equal(
    templateHeadline(m),
    "Today holds 90 minutes of goal time. On Monday the 10:30 block lost 24 minutes to Instagram.",
  );
  // The goal line still counts his word, as the score does.
  const row = buildScore(events, all, { date: "2026-11-11", now: T("2026-11-11 07:30") }).goals.find(
    (g) => g.goal_id === SALES,
  );
  assert.equal(m.goals.find((g) => g.goal_id === SALES)?.spent_week_minutes, row?.spent_minutes);
});

// ---------- row 5: one total per goal ----------

test("the goal lines are the score's numbers, for a training goal too", () => {
  const all = [...goals, training, { ...goal("personal", U, "University"), weekly_budget_minutes: 360 }];
  const events = [
    ...history(),
    ...todayPlan(),
    // A run booked for 90 minutes; the watch saw 65. The score counts the block.
    calendar("Run", T("2026-11-09 07:00"), T("2026-11-09 08:30")),
    workout(T("2026-11-09 07:05"), T("2026-11-09 08:10"), "Run"),
    calendar("Rhefuel", T("2026-11-13 09:00"), T("2026-11-13 10:30")),
    mac(APPS.editor, T("2026-11-11 10:00"), T("2026-11-11 10:40")),
    mac(APPS.social, T("2026-11-11 10:40"), T("2026-11-11 11:00")),
  ];
  for (const [kind, now] of [
    ["morning", "2026-11-11 07:30"],
    ["evening", "2026-11-11 21:00"],
  ] as const) {
    const m = computeMoment({ kind, events, goals: all, now: T(now) });
    const score = buildScore(events, all, { date: "2026-11-11", now: T(now) });
    for (const row of score.goals.filter((g) => g.scored)) {
      const line = m.goals.find((g) => g.goal_id === row.goal_id);
      const today = row.daily.find((d) => d.date === "2026-11-11");
      assert.equal(line?.spent_week_minutes, row.spent_minutes, `${kind} ${row.title} week`);
      assert.equal(line?.planned_ahead_minutes, row.ahead_minutes, `${kind} ${row.title} ahead`);
      assert.equal(line?.planned_today_minutes, today?.planned_minutes, `${kind} ${row.title} planned`);
      assert.equal(line?.spent_today_minutes, today?.spent_minutes, `${kind} ${row.title} today`);
      // What Goals shows as left is the budget less the same spent minutes.
      assert.equal((line?.budget_minutes ?? 0) - (line?.spent_week_minutes ?? 0), row.minutes_left);
    }
    assert.equal(m.totals.planned_minutes, score.day.planned_minutes);
    assert.equal(m.totals.spent_minutes, score.day.spent_minutes);
    assert.equal(m.totals.lost_minutes, score.day.lost_minutes);
  }
  // The run: 90 minutes of block, not the 65 the watch saw.
  const m = morning(events, "2026-11-11 07:30", all);
  const run = m.goals.find((g) => g.goal_id === TRAIN);
  assert.equal(run?.spent_week_minutes, 90);
  assert.equal(run?.planned_ahead_minutes, 90);
});

// ---------- row 12: the booking line ----------

test("the booking line names the goal and starts at least 15 minutes ahead", () => {
  const uni: Goal[] = [{ ...goal("personal", U, "University"), weekly_budget_minutes: 360 }];
  const zoneClock = (iso: string | null | undefined) =>
    new Date(Date.parse(iso ?? "") + 2 * 3600_000).toISOString().slice(11, 16);
  for (const [now, starts] of [
    ["07:00", "08:00"], // the day opens at 08:00
    ["08:00", "08:15"],
    ["08:07", "08:30"], // 08:22 is 15 minutes ahead; the next quarter is 08:30
    ["10:31", "11:00"],
  ] as const) {
    const m = morning([], `2026-11-11 ${now}`, uni);
    const book = m.suggestions.find((s) => s.action_kind === "create_focus_block");
    assert.equal(book?.title, `Book 75 minutes for University at ${starts}`, now);
    assert.equal(zoneClock(book?.start_at), starts);
    assert.ok(Date.parse(book?.start_at ?? "") - Date.parse(T(`2026-11-11 ${now}`)) >= 15 * 60_000);
    assert.equal(book?.goal_id, U);
    // "6h", as everywhere else, never "6h 00".
    assert.equal(book?.rationale, "6h of 6h for University left this week and none of it booked.");
    assert.doesNotMatch(`${book?.title} ${book?.rationale}`, /deep work|of work|\dh 00/);
  }
  // Tomorrow's first move opens at 08:00 whatever the hour now.
  const e = evening([], "2026-11-11 21:00", uni);
  assert.equal(e.first_move?.title, "Book 75 minutes for University at 08:00 tomorrow");
  // No room left today: the move has no time and no action.
  const late = morning([], "2026-11-11 20:50", uni);
  assert.equal(late.suggestions[0]?.title, "Find 75 minutes for University");
  assert.equal(late.suggestions[0]?.action_kind, null);
});

// ---------- row 16: the evening adds up ----------

test("the evening counts only what was lost inside goal blocks, so the numbers add up", () => {
  const events = [
    ...history(),
    ...todayPlan(),
    mac(APPS.editor, T("2026-11-11 10:00"), T("2026-11-11 11:38")),
    mac(APPS.social, T("2026-11-11 11:38"), T("2026-11-11 12:00")),
    // An hour of deep work outside any block, broken by Instagram: a focus stretch, not goal time.
    mac(APPS.editor, T("2026-11-11 15:00"), T("2026-11-11 15:40")),
    mac(APPS.social, T("2026-11-11 15:40"), T("2026-11-11 15:44")),
    mac(APPS.editor, T("2026-11-11 15:44"), T("2026-11-11 16:30")),
  ];
  const m = evening(events, "2026-11-11 19:00");
  const score = buildScore(events, goals, { date: "2026-11-11", now: T("2026-11-11 19:00") });
  assert.equal(m.totals.lost_minutes, 22);
  assert.equal(m.totals.lost_minutes, score.day.lost_minutes);
  assert.equal(m.totals.spent_minutes + m.totals.lost_minutes, m.totals.planned_minutes);
  assert.equal(m.totals.won_back_minutes, score.day.time_won_back.minutes);
  assert.equal(templateHeadline(m), "You held 98 minutes of 2h planned goal time. 22 minutes got away.");
  assert.equal(m.lesson, "Instagram cost 22 minutes in 1 interruption today.");

  // A block still ahead in the evening: held and lost cover what has elapsed, never more than planned.
  const withGym = [...events, calendar("Gym", T("2026-11-11 20:30"), T("2026-11-11 21:30"))];
  const early = evening(withGym, "2026-11-11 19:00");
  assert.equal(early.totals.planned_minutes, 180);
  assert.ok(early.totals.spent_minutes + early.totals.lost_minutes <= early.totals.planned_minutes);
  assert.equal(
    templateHeadline(early),
    "You held 98 minutes of 3h planned goal time. 22 minutes got away, 60 minutes still ahead.",
  );

  // A good day reads "against your usual day".
  const good = evening([...history(), ...todayPlan()], "2026-11-11 21:00");
  assert.equal(
    templateHeadline(good),
    "All 2h of planned goal time held, nothing lost. 20 minutes won back against your usual day.",
  );
  // Before the first block has started there is nothing held or lost to report.
  const before = evening([...history(), ...todayPlan()], "2026-11-11 02:00");
  assert.equal(templateHeadline(before), "2h of goal time still ahead today.");
  assert.equal(before.lesson, "Nothing lost so far. 2h of goal time still ahead today.");
});
