import assert from "node:assert/strict";
import { test } from "node:test";
import { type Event, type Goal, type Nudge, voiceProblems } from "@michael/shared";
import { PhoneLive } from "../ingest/phone-live";
import { APPS, calendar, goal, mac, phone, shortcut, sleep, T } from "../patterns/testkit";
import { candidates, decide, type EngineInput, isValidCopy, testCandidate, wordCount } from "./engine";
import { isLatePhone, isPhoneBlock, phoneOpens, phoneUse, type RealtimeInput } from "./realtime";

// Tuesday 10 November 2026, Athens winter time. Every app and time is made up.
const DAY = "2026-11-10";
const NEXT = "2026-11-11";
const at = (time: string, day = DAY) => T(`${day} ${time}`);
const ms = (time: string, day = DAY) => Date.parse(at(time, day));

const WORK = goal("work", "00000000-0000-4000-8000-0000000000b1", "Ship the pitch");
const GYM = goal("gym", "00000000-0000-4000-8000-0000000000b2", "70.3 training");
const REST = goal("rest", "00000000-0000-4000-8000-0000000000b3", "Sleep 8 hours");
const PERSONAL = goal("personal", "00000000-0000-4000-8000-0000000000b4", "University");

const open = (time: string, app = "Instagram", day = DAY) => ({
  app,
  action: "open" as const,
  at: ms(time, day),
});

const input = (
  now: string,
  events: Event[],
  goals: Goal[],
  realtime: RealtimeInput = {},
  today: EngineInput["today"] = [],
): EngineInput => ({ now, goals, events, today, realtime });

const sent = (
  time: string,
  key: string,
  kind?: Nudge["kind"],
): Pick<Nudge, "key" | "status" | "created_at"> & Partial<Pick<Nudge, "kind">> => ({
  key,
  status: "sent",
  created_at: time,
  ...(kind ? { kind } : {}),
});

/** A line Michael may say as a nudge: his voice, under 15 words. */
const clean = (text: string) => {
  assert.deepEqual(voiceProblems(text), [], text);
  assert.ok(isValidCopy(text), text);
  assert.ok(wordCount(text) < 15, text);
};

// ---------- the phone inside a block ----------

const block = calendar("Deep work", at("13:00"), at("14:00"));
// Four opens the next open already closed (stored events), and the app in front now (live only).
const fourStored = [
  shortcut("Instagram", at("13:04"), at("13:06")),
  shortcut("Mail", at("13:11"), at("13:12")),
  shortcut("Instagram", at("13:18"), at("13:21")),
  shortcut("Messages", at("13:25"), at("13:26")),
];

test("five phone opens inside a running block nudge once, in the deep work that is otherwise quiet", () => {
  const events = [block, mac(APPS.editor, at("13:00"), at("13:31")), ...fourStored];
  const live = [
    open("13:04"),
    open("13:11", "Mail"),
    open("13:18"),
    open("13:25", "Messages"),
    open("13:30"),
  ];
  const d = decide(input(at("13:31"), events, [WORK, GYM], { live }));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.kind, "focus_drift");
  assert.equal(d.candidate.key, `focus_drift:${block.id}`);
  assert.equal(d.candidate.goal_id, WORK.id);
  assert.equal(d.candidate.text, "5 phone opens in Ship the pitch. Put it down until 14:00.");
  assert.equal(
    d.candidate.reason,
    "5 phone opens since 13:00, the last at 13:30; the block runs 13:00 to 14:00 for Ship the pitch.",
  );
  clean(d.candidate.text);
  assert.ok(isPhoneBlock(d.candidate));
});

test("four opens say nothing, and the fifth still counts when the API restarted (stored events only)", () => {
  const events = [block, ...fourStored];
  assert.equal(candidates(input(at("13:31"), events, [WORK])).find(isPhoneBlock), undefined);
  assert.equal(decide(input(at("13:31"), events, [WORK])).action, "skip");
  const five = [...events, shortcut("Instagram", at("13:30"), at("13:33"))];
  const d = decide(input(at("13:34"), five, [WORK]));
  assert.equal(d.action, "send");
});

test("the same app opened five times counts five times, though the pairer stores one event", () => {
  const live = ["13:02", "13:09", "13:15", "13:22", "13:28"].map((t) => open(t));
  const d = decide(input(at("13:29"), [block], [WORK], { live }));
  assert.equal(d.action, "send");
  if (d.action === "send") assert.match(d.candidate.text, /^5 phone opens in /);
});

test("opens less than 30 seconds apart are one, and opens before the block do not count", () => {
  const live = [
    open("12:50"),
    open("12:58"),
    { app: "Instagram", action: "open" as const, at: ms("13:05") },
    { app: "Mail", action: "open" as const, at: ms("13:05") + 20_000 },
    open("13:10"),
    open("13:15"),
    open("13:20"),
  ];
  assert.equal(phoneOpens([], live, ms("13:00"), ms("13:30")).length, 4);
  assert.equal(candidates(input(at("13:30"), [block], [WORK], { live })).find(isPhoneBlock), undefined);
});

test("where Apple's own log covers the hour an open is a pick up, and the live signals step aside", () => {
  // One pick up of three apps, then a second one: two opens, whatever the shortcut also reported.
  const events = [
    phone(APPS.home, at("13:05:00"), at("13:05:05")),
    phone(APPS.social, at("13:05:05"), at("13:07:00")),
    phone(APPS.chat, at("13:07:10"), at("13:08:00")),
    phone(APPS.social, at("13:20:00"), at("13:21:00")),
  ];
  const live = ["13:05", "13:07", "13:20", "13:22", "13:24"].map((t) => open(t));
  assert.deepEqual(phoneOpens(events, live, ms("13:00"), ms("13:30")), [ms("13:05"), ms("13:20")]);
});

test("a training block, Off the record and dinner all stay silent", () => {
  const live = ["18:02", "18:09", "18:15", "18:22", "18:28"].map((t) => open(t));
  const gym = calendar("Gym: legs", at("18:00"), at("19:00"));
  assert.equal(candidates(input(at("18:29"), [gym], [GYM], { live })).find(isPhoneBlock), undefined);

  const five = ["13:02", "13:09", "13:15", "13:22", "13:28"].map((t) => open(t));
  assert.deepEqual(decide({ ...input(at("13:29"), [block], [WORK], { live: five }), offTheRecord: true }), {
    action: "skip",
    skipped: "off_the_record",
  });

  const evening = calendar("Reading", at("20:00"), at("21:00"), { goal_id: PERSONAL.id });
  const late = ["20:02", "20:09", "20:15", "20:22", "20:28"].map((t) => open(t));
  assert.ok(candidates(input(at("20:29"), [evening], [PERSONAL], { live: late })).some(isPhoneBlock));
  assert.deepEqual(decide(input(at("20:29"), [evening], [PERSONAL], { live: late })), {
    action: "skip",
    skipped: "quiet_hours",
  });
});

test("a block of a personal goal counts too, and names the goal", () => {
  const study = calendar("Statistics", at("16:00"), at("17:30"), { goal_id: PERSONAL.id });
  const live = ["16:02", "16:09", "16:15", "16:22", "16:28", "16:40"].map((t) => open(t));
  const d = decide(input(at("16:41"), [study], [PERSONAL], { live }));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.text, "6 phone opens in University. Put it down until 17:30.");
  clean(d.candidate.text);
});

test("one nudge a block: a drift already sent for it, from the Mac or the phone, is the only one", () => {
  const live = ["13:02", "13:09", "13:15", "13:22", "13:28"].map((t) => open(t));
  const today = [sent(at("13:10"), `focus_drift:${block.id}`, "focus_drift")];
  // The candidate is still there; the block's key has been used, so nothing goes out.
  assert.ok(candidates(input(at("13:29"), [block], [WORK], { live })).some(isPhoneBlock));
  assert.equal(decide(input(at("13:29"), [block], [WORK], { live }, today)).action, "skip");
});

test("it counts towards the five a day: the sixth is kept back, not sent", () => {
  const live = ["13:02", "13:09", "13:15", "13:22", "13:28"].map((t) => open(t));
  const today = ["08:00", "09:00", "10:00", "11:00", "12:00"].map((t) =>
    sent(at(t), `k:${t}`, "goal_behind"),
  );
  const d = decide(input(at("13:29"), [block], [WORK], { live }, today));
  assert.equal(d.action, "suppress");
});

test("a long goal title is cut so the line stays under 15 words", () => {
  const long = { ...WORK, title: "Close the first ten customers for the listing platform" };
  const live = ["13:02", "13:09", "13:15", "13:22", "13:28"].map((t) => open(t));
  const c = candidates(input(at("13:29"), [block], [long], { live })).find(isPhoneBlock);
  assert.equal(c?.text, "5 phone opens in Close the first ten customers. Put it down until 14:00.");
  clean(c?.text ?? "");
});

// ---------- the phone before sleep ----------

test("40 minutes of phone after the late cut off nudge inside the night, with the real minutes", () => {
  // In bed with one app since 23:10: nothing is stored yet, the open is live.
  const tomorrow = calendar("Deep work", at("09:00", NEXT), at("11:00", NEXT));
  const realtime = { live: [open("23:10")], firstBlockAt: tomorrow.start_at };
  assert.deepEqual(decide(input(at("23:49"), [], [WORK, REST], realtime)), {
    action: "skip",
    skipped: "nothing_to_say",
  });
  const d = decide(input(at("23:50"), [], [WORK, REST], realtime));
  assert.equal(d.action, "send");
  if (d.action !== "send") return;
  assert.equal(d.candidate.kind, "wind_down");
  assert.equal(d.candidate.key, `late_phone:${DAY}`);
  assert.equal(d.candidate.goal_id, REST.id);
  assert.equal(d.candidate.text, "40 minutes on your phone since 23:10. Stop here. First block at 09:00.");
  assert.equal(
    d.candidate.reason,
    "40 minutes on your phone since 23:00, the late cut off; the last at 23:50.",
  );
  clean(d.candidate.text);
  assert.ok(isLatePhone(d.candidate));
});

test("only the minutes after the cut off count, from stored sessions and the app in front", () => {
  const events = [
    shortcut("YouTube", at("22:30"), at("23:15")),
    shortcut("Instagram", at("23:15"), at("23:30")),
  ];
  const live = [open("22:30", "YouTube"), open("23:15"), open("23:30", "TikTok")];
  // 23:00 to 23:42 is 42 minutes; the 30 minutes before the cut off are not in it.
  const c = candidates(input(at("23:42"), events, [REST], { live })).find(isLatePhone);
  assert.equal(c?.text, "42 minutes on your phone since 23:00. Stop here. Sleep is a goal too.");
  clean(c?.text ?? "");
  assert.equal(candidates(input(at("23:39"), events, [REST], { live })).find(isLatePhone), undefined);
});

test("without a sleep goal or a block tomorrow the line is the number and the fix", () => {
  const c = candidates(input(at("23:55"), [], [WORK], { live: [open("23:05")] })).find(isLatePhone);
  assert.equal(c?.text, "45 minutes on your phone since 23:05. Stop here.");
  assert.equal(c?.goal_id, null);
  clean(c?.text ?? "");
});

test("a phone put down is left alone: the app in front stops counting and the nudge needs recent use", () => {
  const live = [open("23:10")];
  // Nothing since 23:10: the open counts 45 minutes at most, and by 00:10 it is 15 minutes old.
  assert.equal(
    phoneUse([], live, ms("23:00"), ms("00:10", NEXT)).reduce((a, s) => a + s.end - s.start, 0),
    45 * 60_000,
  );
  assert.equal(candidates(input(at("00:10", NEXT), [], [REST], { live })).find(isLatePhone), undefined);
  // A close ends it at once.
  const closed = [open("23:10"), { app: "Instagram", action: "close" as const, at: ms("23:20") }];
  assert.equal(candidates(input(at("23:55"), [], [REST], { live: closed })).find(isLatePhone), undefined);
});

test("one nudge a night, on both sides of midnight", () => {
  const live = [open("23:30"), open("00:05", "Instagram", NEXT)];
  const after = input(at("00:12", NEXT), [], [REST], { live });
  const c = candidates(after).find(isLatePhone);
  // The night belongs to the evening it started on.
  assert.equal(c?.key, `late_phone:${DAY}`);
  assert.equal(c?.text, "42 minutes on your phone since 23:30. Stop here. Sleep is a goal too.");
  const already = input(at("00:12", NEXT), [], [REST], { live, earlierKeys: [`late_phone:${DAY}`] });
  assert.equal(candidates(already).find(isLatePhone), undefined);
  // Before midnight the day's own nudges carry the key.
  const today = [sent(at("23:45"), `late_phone:${DAY}`, "wind_down")];
  assert.deepEqual(decide(input(at("23:58"), [], [REST], { live: [open("23:00")] }, today)), {
    action: "skip",
    skipped: "nothing_to_say",
  });
});

test("the cut off is an hour before the usual bedtime once three nights are known", () => {
  const nights = ["2026-11-07", "2026-11-08", "2026-11-09"].map((d) =>
    sleep(T(`${d} 00:30`), T(`${d} 07:30`)),
  );
  // Usual bedtime 00:30, so the cut off is 23:30: 23:10 to 23:30 does not count.
  const live = [open("23:10"), open("23:50", "YouTube")];
  assert.equal(candidates(input(at("23:55"), nights, [REST], { live })).find(isLatePhone), undefined);
  const c = candidates(input(at("00:11", NEXT), nights, [REST], { live })).find(isLatePhone);
  assert.equal(c?.text, "41 minutes on your phone since 23:30. Stop here. Sleep is a goal too.");
  assert.match(c?.reason ?? "", /since 23:30, an hour before your usual bedtime of 00:30/);
});

test("the line before the night and the line inside it never land in the same half hour", () => {
  // Quiet hours from 23:30: wind_down speaks 23:00 to 23:30, the late cut off is 23:00.
  const quiet = { nightStart: 23 * 60 + 30, nightEnd: 7 * 60, dinner: null, deepWork: true };
  const events = [mac(APPS.tv, at("22:00"), at("23:41"))];
  const live = [open("23:00")];
  const windDown = [sent(at("23:15"), "wind_down", "wind_down")];
  const held = decide({ ...input(at("23:41"), events, [REST], { live }, windDown), quiet });
  assert.deepEqual(held, { action: "skip", skipped: "nothing_to_say" });
  const later = decide({ ...input(at("23:46"), events, [REST], { live }, windDown), quiet });
  assert.equal(later.action, "send");
  if (later.action === "send") assert.ok(isLatePhone(later.candidate));
});

test("what Michael has learnt goes on the reason, and into the line when it fits", () => {
  const learnt = {
    late_phone: {
      line: "It costs 14 sleep points.",
      reason: "Late phone: 14 points of sleep score, 9 of 11 nights.",
    },
    phone_block: { reason: "Blocks with 5 opens or more: 22 minutes lost, 6 of 8 times." },
  };
  const late = candidates(input(at("23:50"), [], [REST], { live: [open("23:10")], learnt })).find(
    isLatePhone,
  );
  assert.equal(late?.text, "40 minutes on your phone since 23:10. Stop here. It costs 14 sleep points.");
  assert.match(
    late?.reason ?? "",
    /the last at 23:50\. Late phone: 14 points of sleep score, 9 of 11 nights\.$/,
  );
  clean(late?.text ?? "");
  const live = ["13:02", "13:09", "13:15", "13:22", "13:28"].map((t) => open(t));
  const inBlock = candidates(input(at("13:29"), [block], [WORK], { live, learnt })).find(isPhoneBlock);
  assert.match(
    inBlock?.reason ?? "",
    /for Ship the pitch\. Blocks with 5 opens or more: 22 minutes lost, 6 of 8 times\.$/,
  );
});

// ---------- the stage's test nudge ----------

test("the test nudge sends either line by name at any hour, from real numbers", () => {
  // 15:10, one open in the block, 12 minutes of phone in the last hour: neither is a real nudge.
  const afternoon = calendar("Deep work", at("15:00"), at("16:00"));
  const events = [afternoon, shortcut("Instagram", at("14:40"), at("14:52"))];
  const live = [
    open("14:40"),
    { app: "Instagram", action: "close" as const, at: ms("14:52") },
    open("15:05"),
  ];
  const plain = candidates(input(at("15:10"), events, [WORK], { live }));
  assert.equal(plain.find(isPhoneBlock) ?? plain.find(isLatePhone), undefined);

  const inBlock = testCandidate(input(at("15:10"), events, [WORK], { live, test: "phone_block" }));
  assert.equal(inBlock?.text, "1 phone open in Ship the pitch. Put it down until 16:00.");
  const late = testCandidate(input(at("15:10"), events, [WORK], { live, test: "late_phone" }));
  assert.equal(late?.text, "17 minutes on your phone since 14:40. Stop here.");
  assert.equal(late?.key, `late_phone:${DAY}`);
  clean(inBlock?.text ?? "");
  clean(late?.text ?? "");
  // And at night the real one goes out through the same path, whatever the quiet hours say.
  const real = testCandidate(input(at("23:50"), [], [REST], { live: [open("23:10")] }));
  assert.ok(real && isLatePhone(real));
});

// ---------- the live signals ----------

test("live signals are kept per user for 12 hours, in the order they happened", () => {
  const log = new PhoneLive();
  const t0 = ms("13:00");
  log.record("a", { app: "Instagram", action: "open", at: undefined }, t0);
  log.record("a", { app: "Mail", action: "open", at: at("12:59") }, t0 + 1000);
  log.record("b", { app: "Maps", action: "open", at: "not a date" }, t0 + 2000);
  assert.deepEqual(
    log.since("a", 0).map((s) => s.app),
    ["Mail", "Instagram"],
  );
  assert.deepEqual(log.since("b", 0), [{ app: "Maps", action: "open", at: t0 + 2000 }]);
  assert.equal(log.since("a", t0).length, 1);
  log.record("a", { app: "Notes", action: "close", at: undefined }, t0 + 13 * 3600_000);
  assert.deepEqual(
    log.since("a", 0).map((s) => s.app),
    ["Notes"],
  );
});
