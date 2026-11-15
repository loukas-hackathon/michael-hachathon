import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { CheckInToday, type Event, type EventInput, type Goal, voiceProblems } from "@michael/shared";
import type { z } from "zod";
import { app } from "../app";
import { runAsUser } from "../context";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { buildChatContext } from "../routes/chat";
import { store } from "../store";
import { dayQuestions, followUpFor } from "./questions";
import { answerCheckIn, checkInContext, checkInToday, deleteCheckIn } from "./service";

// Thursday 12 November 2026, Athens (UTC+02:00). Every app, title and time is made up.
const T = (hm: string) => `2026-11-12T${hm}:00+02:00`;
const at = (hm: string) => Date.parse(T(hm));
const zone = new Zone(DEFAULT_TIMEZONE);
const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };

type Input = z.input<typeof EventInput>;
const DAY: Input[] = [
  // Last night: 5h 10.
  { source: "manual", type: "sleep", start_at: T("01:30"), end_at: T("06:40"), title: "Sleep", data: {} },
  // A gym block with a workout in it, and a run block with none.
  {
    source: "manual",
    type: "calendar_event",
    start_at: T("07:30"),
    end_at: T("08:30"),
    title: "Gym",
    data: {},
  },
  {
    source: "manual",
    type: "workout",
    start_at: T("07:35"),
    end_at: T("08:25"),
    title: "Strength",
    data: {},
  },
  {
    source: "manual",
    type: "calendar_event",
    start_at: T("18:30"),
    end_at: T("19:30"),
    title: "Run",
    data: {},
  },
  // A meeting with other people.
  {
    source: "manual",
    type: "calendar_event",
    start_at: T("16:00"),
    end_at: T("16:30"),
    title: "Investor call",
    data: { with_others: true, attendees: 3 },
  },
  // The Mac from 09:00 to 14:00 and 15:10 to 18:00: 14:00 to 15:10 is unaccounted for.
  {
    source: "macos_usage",
    type: "app_usage",
    start_at: T("09:00"),
    end_at: T("14:00"),
    title: "VS Code",
    data: { bundle_id: "com.microsoft.VSCode", device: "mac" },
  },
  {
    source: "macos_usage",
    type: "app_usage",
    start_at: T("15:10"),
    end_at: T("18:00"),
    title: "VS Code",
    data: { bundle_id: "com.microsoft.VSCode", device: "mac" },
  },
];

const asEvents = (inputs: Input[]): Event[] =>
  inputs.map((e, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    external_id: null,
    created_at: T("00:00"),
    end_at: e.end_at ?? null,
    title: e.title ?? "",
    data: e.data ?? {},
    source: e.source,
    type: e.type,
    start_at: e.start_at,
  }));

const training: Goal = {
  id: "00000000-0000-4000-8000-0000000000a1",
  category: "health",
  title: "Training",
  description: null,
  target: { calendar_titles: ["Gym", "Run"] },
  weekly_budget_minutes: 300,
  active: true,
  created_at: T("00:00"),
  updated_at: T("00:00"),
};

/** A user with nothing but this day and the training goal. */
const withDay = <T>(fn: () => Promise<T>) =>
  runAsUser(randomUUID(), async () => {
    await store.deleteMyData({ everything: true });
    await store.insertEvents(DAY as never);
    await store.createGoal({
      category: "health",
      title: "Training",
      target: { calendar_titles: ["Gym", "Run"] },
      weekly_budget_minutes: 300,
      active: true,
    });
    return fn();
  });

test("a day with a missed run, a Mac gap, a gym session, a meeting and a short night gives the questions in order", () => {
  const qs = dayQuestions({ now: at("21:00"), zone, events: asEvents(DAY), goals: [training] });
  assert.deepEqual(
    qs.map((q) => [q.kind, q.question]),
    [
      ["missed_block", "Run, 18:30 to 19:30. No workout recorded. Did you train?"],
      ["unaccounted", "14:00 to 15:10 is unaccounted for on your Mac. Were you in a meeting?"],
      ["training", "Gym, 07:30 to 08:30. How did it go? 1 to 5."],
      ["meeting", "Investor call, 16:00. Did it go the way you wanted?"],
      ["short_night", "You slept 5h 10. Energy today? 1 to 5."],
    ],
  );
  for (const q of qs) assert.deepEqual(voiceProblems(q.question), [], q.question);
  // Nothing that has not ended yet: at 12:00 only the gym session and the night.
  const noon = dayQuestions({ now: at("12:00"), zone, events: asEvents(DAY), goals: [training] });
  assert.deepEqual(
    noon.map((q) => q.kind),
    ["training", "short_night"],
  );
});

test("a no on the meeting after a short night asks the sleep follow up; a good night asks none", () => {
  const meeting = {
    id: randomUUID(),
    key: "meeting:x",
    kind: "meeting" as const,
    day: "2026-11-12",
    event_id: null,
    goal_id: null,
    start_at: T("16:00"),
    end_at: T("16:30"),
  };
  assert.equal(followUpFor(meeting, "no", 310, zone)?.question, "You slept 5h 10. Did that play a part?");
  assert.equal(followUpFor(meeting, "no", 470, zone), null);
  assert.equal(followUpFor(meeting, "yes", 310, zone), null);
  const gap = {
    ...meeting,
    key: "unaccounted:x",
    kind: "unaccounted" as const,
    start_at: T("14:00"),
    end_at: T("15:10"),
  };
  assert.equal(followUpFor(gap, "no", null, zone)?.question, "14:00 to 15:10. What was it? A few words.");
});

test("two rounds at most: the missed block right after it, the rest in the evening, nothing more after", () =>
  withDay(async () => {
    const after = await checkInToday(at("19:45"));
    assert.equal(after.moment, "missed_block");
    assert.deepEqual(
      after.questions.map((q) => q.kind),
      ["missed_block"],
    );
    // Asked again before the evening: the same single question.
    assert.equal((await checkInToday(at("19:55"))).questions.length, 1);

    const evening = await checkInToday(at("21:00"));
    assert.equal(evening.open, true);
    assert.deepEqual(
      evening.questions.map((q) => q.kind),
      ["missed_block", "unaccounted", "training", "meeting", "short_night"],
    );
    const later = await checkInToday(at("22:30"));
    assert.equal(later.questions.length, 5);
  }));

test("a workout that syncs after its block was asked about settles the missed block question", () =>
  withDay(async () => {
    const after = await checkInToday(at("19:45"));
    assert.deepEqual(
      after.questions.map((q) => q.kind),
      ["missed_block"],
    );
    // The watch sends the run a little late: it ended after the block did.
    await store.insertEvents([
      {
        source: "manual",
        type: "workout",
        start_at: T("18:40"),
        end_at: T("19:50"),
        title: "Run",
        data: {},
      },
    ] as never);
    const synced = await checkInToday(at("19:55"));
    assert.ok(!synced.questions.some((q) => q.kind === "missed_block"));
    assert.equal((await checkInContext(at("19:55"))).open.length, 0);
    // The evening asks how the run went instead.
    const evening = await checkInToday(at("21:00"));
    assert.ok(!evening.questions.some((q) => q.kind === "missed_block"));
    assert.ok(evening.questions.some((q) => q.kind === "training" && q.question.startsWith("Run,")));
  }));

test("answers are stored once, labelled, followed up, read back to the chat and can be deleted", () =>
  withDay(async () => {
    const today = CheckInToday.parse(await checkInToday(at("21:00")));
    const byKind = (k: string) => today.questions.find((q) => q.kind === k);
    const meeting = byKind("meeting");
    const gap = byKind("unaccounted");
    assert.ok(meeting && gap);

    const answered = await answerCheckIn(meeting.id, "no", at("21:05"));
    assert.equal(answered.check_in.answer, "no");
    assert.equal(answered.follow_up?.question, "You slept 5h 10. Did that play a part?");
    await assert.rejects(answerCheckIn(meeting.id, "yes", at("21:06")), /already answered/);

    const settled = await answerCheckIn(gap.id, "yes", at("21:06"));
    assert.equal(settled.check_in.label, "meeting");
    assert.equal(settled.follow_up, null);

    // The follow up sits right after its question.
    const again = await checkInToday(at("21:07"));
    const idx = again.questions.findIndex((q) => q.id === meeting.id);
    assert.equal(again.questions[idx + 1]?.kind, "follow_up");

    const context = await checkInContext(at("21:07"));
    assert.equal(context.answered.length, 2);
    const text = buildChatContext({
      now: at("21:07"),
      goals: [],
      events: [],
      today: null,
      week: null,
      checkIns: context,
    });
    assert.match(text, /What you told me/);
    assert.match(
      text,
      /14:00 to 15:10 is unaccounted for on your Mac\. Were you in a meeting\? Answer: yes \[meeting\]/,
    );
    assert.match(text, /Open check in questions today:[\s\S]*\{check_in_id /);

    await deleteCheckIn(meeting.id);
    const after = await checkInToday(at("21:08"));
    // The question and its follow up are gone.
    assert.ok(!after.questions.some((q) => q.id === meeting.id || q.follow_up_of === meeting.id));
  }));

test("the check in routes: today, answer with zod checked values, delete", () =>
  withDay(async () => {
    const res = await app.request("/v1/check-in", { headers: auth });
    assert.equal(res.status, 200);
    CheckInToday.parse(await res.json());
    const bad = await app.request(`/v1/check-in/${randomUUID()}/answer`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ value: 9 }),
    });
    assert.equal(bad.status, 400);
    const missing = await app.request(`/v1/check-in/${randomUUID()}/answer`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ value: "yes" }),
    });
    assert.equal(missing.status, 404);
  }));
