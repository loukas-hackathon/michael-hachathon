import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type Event, type OnboardingTurn, OnboardingTurnResponse, voiceProblems } from "@michael/shared";
import { FakeModelClient, type ModelClient, useModelClient } from "../analysis/model";
import { runAsUser } from "../context";
import { store } from "../store";
import {
  clearOnboardingFacts,
  nextScriptQuestion,
  onboardingTurn,
  SCRIPT_QUESTIONS,
  scriptOpener,
  speakable,
  talkState,
  weekFacts,
} from "./turn";

// The onboarding talk: opener, follow ups, skips, when it ends, and the script whenever the model
// cannot be trusted with the line.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const reply = (line: string, done = false, uses_calendar = false) =>
  JSON.stringify({ line, done, uses_calendar });
const michael = (text: string): OnboardingTurn => ({ role: "michael", text });
const user = (text: string): OnboardingTurn => ({ role: "user", text });
const skip: OnboardingTurn = { role: "user", text: "", skipped: true };
const OPENER = "Let's start with the big one. What are you working towards right now?";

/** A fresh user with no events at all (a new user starts with sample events). */
async function freshUser<T>(fn: () => Promise<T>): Promise<T> {
  return runAsUser(randomUUID(), async () => {
    for (const e of await store.listEvents({
      from: "2000-01-01T00:00:00.000Z",
      to: iso(Date.now() + 365 * DAY),
    }))
      await store.deleteEvents([e.id]);
    return fn();
  });
}

/** Three weeks of the user's own gym on Mon, Wed and Fri evenings, and meetings on Tue and Thu mornings. */
function calendarWeeks(now = Date.now()) {
  const events = [];
  for (let i = 1; i <= 21; i++) {
    const dayStart = Math.floor((now - i * DAY) / DAY) * DAY;
    const weekday = new Date(dayStart).getUTCDay();
    if ([1, 3, 5].includes(weekday))
      events.push({
        source: "google_calendar" as const,
        type: "calendar_event" as const,
        start_at: iso(dayStart + 17 * 60 * MIN),
        end_at: iso(dayStart + 18 * 60 * MIN),
        title: "Gym",
        data: { attendees: 0 },
        external_id: `test:${randomUUID()}`,
      });
    if ([2, 4].includes(weekday))
      events.push({
        source: "google_calendar" as const,
        type: "calendar_event" as const,
        start_at: iso(dayStart + 8 * 60 * MIN),
        end_at: iso(dayStart + 9 * 60 * MIN),
        title: "Investor call",
        data: { attendees: 2, with_others: true },
        external_id: `test:${randomUUID()}`,
      });
  }
  return events;
}

async function turn(turns: OnboardingTurn[], model: ModelClient | null, timeoutMs?: number) {
  useModelClient(model);
  try {
    return OnboardingTurnResponse.parse(await onboardingTurn(turns, { timeoutMs }));
  } finally {
    useModelClient(null);
  }
}

test("opener without a calendar: Claude's line, not from the calendar", () =>
  freshUser(async () => {
    const fake = new FakeModelClient([reply(OPENER, false, true)]);
    const r = await turn([], fake);
    assert.deepEqual(r, { line: OPENER, done: false, from_calendar: false, source: "model" });
    assert.match(fake.requests[0]?.user ?? "", /No calendar connected/);
    assert.match(fake.requests[0]?.user ?? "", /Turn: opener/);
    assert.equal(fake.requests[0]?.effort, "low");
  }));

test("opener without a key: the warm scripted opener", () =>
  freshUser(async () => {
    const r = await turn([], null);
    assert.equal(r.source, "script");
    assert.equal(r.from_calendar, false);
    assert.equal(r.done, false);
    assert.ok(r.line.endsWith(SCRIPT_QUESTIONS[0]));
    assert.deepEqual(voiceProblems(r.line), []);
  }));

test("the calendar's facts: recurring own blocks, meetings, free mornings", () => {
  // A Wednesday noon, so the last 7 days hold exactly one Tuesday and one Thursday meeting.
  const now = Date.parse("2026-11-11T12:00:00.000Z");
  const events = calendarWeeks(now).map((e) => ({ ...e, id: randomUUID() }) as unknown as Event);
  const facts = weekFacts(events, new Date(now));
  assert.ok(facts);
  assert.equal(facts.recurring[0]?.weekly_budget_minutes, 180);
  assert.equal(Math.round(facts.recurring[0]?.sessions_per_week ?? 0), 3);
  assert.equal(facts.meetings.count, 2);
  assert.equal(facts.meetings.minutes, 120);
  assert.equal(facts.freeMornings, 3);
  assert.equal(facts.lateEvenings, 0);
  assert.equal(weekFacts([], new Date(now)), null);
});

test("opener with a calendar: Claude sees the facts and the line is from the calendar", () =>
  freshUser(async () => {
    clearOnboardingFacts();
    await store.insertEvents(calendarWeeks());
    const line =
      "Hi, I'm Michael. Training 3 times a week, I see. What do you want the rest of the week to hold?";
    const fake = new FakeModelClient([reply(line, false, true)]);
    const r = await turn([], fake);
    assert.deepEqual(r, { line, done: false, from_calendar: true, source: "model" });
    const brief = fake.requests[0]?.user ?? "";
    assert.match(brief, /Recurring own block: \w+, 3 times a week, 3h a week/);
    assert.match(brief, /Meetings with other people in the last 7 days: \d/);
  }));

test("opener with a calendar: an invented number gives way to the scripted calendar opener", () =>
  freshUser(async () => {
    clearOnboardingFacts();
    await store.insertEvents(calendarWeeks());
    const fake = new FakeModelClient([
      reply("Hi, I'm Michael. Gym 5 times a week. Is that the plan?", false, true),
    ]);
    const r = await turn([], fake);
    assert.equal(r.source, "script");
    assert.equal(r.from_calendar, true);
    assert.match(r.line, /takes about 3h of your week/);
    assert.ok(r.line.endsWith(SCRIPT_QUESTIONS[0]));
  }));

test("a follow up echoes the user and asks one question", () =>
  freshUser(async () => {
    const line = "Investors by December, got it. How many hours a week does that need, and when?";
    const fake = new FakeModelClient([reply(line)]);
    const r = await turn(
      [michael(OPENER), user("Mostly the startup, we raise from investors in December")],
      fake,
    );
    assert.deepEqual(r, { line, done: false, from_calendar: false, source: "model" });
    const brief = fake.requests[0]?.user ?? "";
    assert.match(brief, /User: Mostly the startup/);
    assert.match(brief, /goals heard: .*Fundraising/);
    assert.match(brief, /Turn: follow up\./);
  }));

test("a skipped question: Claude is told to move on, the script moves to the next question", () =>
  freshUser(async () => {
    const fake = new FakeModelClient([reply("No problem. What does a good week look like for you?")]);
    const r = await turn([michael(OPENER), skip], fake);
    assert.equal(r.done, false);
    assert.match(fake.requests[0]?.user ?? "", /\[skipped this question\]/);
    assert.match(fake.requests[0]?.user ?? "", /skipped the last question/);

    const scripted = await turn([michael(`Hi. ${SCRIPT_QUESTIONS[0]}`), skip], null);
    assert.deepEqual(scripted, {
      line: `No problem. ${SCRIPT_QUESTIONS[1]}`,
      done: false,
      from_calendar: false,
      source: "script",
    });
  }));

test("when the talk ends", () => {
  // Five answers.
  assert.equal(talkState([user("a"), user("b"), user("c"), user("d"), user("e")]).finish, true);
  assert.equal(talkState([user("a"), user("b"), user("c"), user("d")]).finish, false);
  // Two skips in a row.
  assert.equal(talkState([michael("q"), skip, michael("q"), skip]).finish, true);
  assert.equal(talkState([michael("q"), skip, michael("q"), user("the gym")]).finish, false);
  // The user says so.
  assert.equal(talkState([michael("q"), user("the startup. that's it")]).finish, true);
  assert.equal(talkState([michael("q"), user("I'm done")]).finish, true);
  // Goals with time and what gets in the way.
  assert.equal(
    talkState([user("ten hours a week on the startup"), user("I lose my evenings on my phone")]).finish,
    true,
  );
  assert.equal(talkState([user("the startup")]).finish, false);
});

test("finishing: Claude's handover is used, a question there is not", () =>
  freshUser(async () => {
    const turns = [
      michael(OPENER),
      user("ten hours a week on the startup"),
      michael("And what gets in the way?"),
      user("my phone at night"),
    ];
    const line = "Phone at night, noted. That's plenty. Here's what I heard.";
    const ok = await turn(turns, new FakeModelClient([reply(line, true)]));
    assert.deepEqual(ok, { line, done: true, from_calendar: false, source: "model" });

    const asks = await turn(turns, new FakeModelClient([reply("Phone at night. When do you sleep?", false)]));
    assert.deepEqual(asks, {
      line: "That's plenty. Here's what I heard.",
      done: true,
      from_calendar: false,
      source: "script",
    });
  }));

test("two skips end the talk, even without a model", () =>
  freshUser(async () => {
    const r = await turn([michael(OPENER), skip, michael(SCRIPT_QUESTIONS[1]), skip], null);
    assert.equal(r.done, true);
    assert.equal(r.source, "script");
    assert.deepEqual(voiceProblems(r.line), []);
  }));

test("Claude may end early once there is an answer, but never with a question", () =>
  freshUser(async () => {
    const r = await turn(
      [michael(OPENER), user("the startup and the gym")],
      new FakeModelClient([
        reply("The startup and the gym. That's enough to start. Here's what I heard.", true),
      ]),
    );
    assert.equal(r.done, true);
    assert.equal(r.source, "model");
    // Still talking but no question: the script asks instead.
    const flat = await turn(
      [michael(OPENER), user("the startup")],
      new FakeModelClient([reply("The startup, noted.")]),
    );
    assert.equal(flat.source, "script");
    assert.equal(flat.line, `Got it. ${SCRIPT_QUESTIONS[1]}`);
  }));

test("a model failure or a slow model falls back to the script", () =>
  freshUser(async () => {
    const failed = await turn(
      [michael(OPENER), user("the startup")],
      new FakeModelClient([new Error("boom")]),
    );
    assert.equal(failed.source, "script");
    assert.equal(failed.line, `Got it. ${SCRIPT_QUESTIONS[1]}`);

    const slow: ModelClient = { model: "slow", complete: () => new Promise(() => {}) };
    const started = Date.now();
    const timedOut = await turn([michael(OPENER), user("the startup")], slow, 50);
    assert.ok(Date.now() - started < 2000);
    assert.equal(timedOut.source, "script");

    const garbage = await turn([michael(OPENER), user("the startup")], new FakeModelClient(["not json"]));
    assert.equal(garbage.source, "script");
  }));

test("a line that breaks the voice rules falls back to the script", () =>
  freshUser(async () => {
    for (const bad of [
      "Amazing, the startup! How many hours a week?",
      "The startup is a journey. How many hours a week?",
      "The startup - nice. How many hours a week?",
      `${"Very long. ".repeat(40)}How many hours?`,
    ]) {
      const r = await turn([michael(OPENER), user("the startup")], new FakeModelClient([reply(bad)]));
      assert.equal(r.source, "script", bad);
    }
  }));

test("the script skips questions already asked or answered", () => {
  const turns = [michael(OPENER), user("the startup, ten hours a week")];
  // Goals and time are covered: straight to where time goes.
  assert.equal(nextScriptQuestion(turns, talkState(turns)), SCRIPT_QUESTIONS[2]);
  const all = [michael(SCRIPT_QUESTIONS.join(" ")), user("hmm")];
  assert.equal(nextScriptQuestion(all, talkState(all)), null);
});

test("speakable numbers come from the facts or the user", () => {
  assert.equal(speakable("Gym 3 times a week. Is that the plan?", "Gym, 3 times a week"), true);
  assert.equal(speakable("Gym 4 times a week. Is that the plan?", "Gym, 3 times a week"), false);
  assert.equal(speakable("Gym 3 times a week", "Gym, 3 times a week"), false);
});

test("the scripted openers keep the voice rules", () => {
  assert.deepEqual(voiceProblems(scriptOpener(null).line), []);
  assert.ok(scriptOpener(null).line.length <= 320);
});
