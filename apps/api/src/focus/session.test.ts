import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { countsTowardsCap, type Event, FocusActiveResponse, FocusSession } from "@michael/shared";
import { runAsUser } from "../context";
import { withoutInstructions } from "../instructions/testkit";
import { store } from "../store";
import {
  activeFocus,
  countedMinutes,
  coveredByDevices,
  doneLine,
  earlyLine,
  endFocus,
  extendedEnd,
  extendFocus,
  finishDueFocusSessions,
  inQuietHours,
  isOnTime,
  shortGoal,
  startFocus,
} from "./session";

// Focus now (#397): the start, +15, end and count rules, and the flow on the memory store.

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A fresh user with one goal, "University", 6 hours a week, and nothing else. */
async function freshUser<T>(fn: (goalId: string) => Promise<T>): Promise<T> {
  return runAsUser(randomUUID(), async () => {
    await withoutInstructions(store);
    for (const g of await store.listGoals()) await store.deleteGoal(g.id);
    // Every event, not only the last day's: a fresh user starts with the sample events, and once
    // their fixed day is over a day old they stayed and read as a connected Mac (created_at is new).
    for (const e of await store.listEvents({
      from: "2000-01-01T00:00:00.000Z",
      to: iso(Date.now() + 365 * 86_400_000),
    }))
      await store.deleteEvents([e.id]);
    const goal = await store.createGoal({
      category: "personal",
      title: "University",
      description: null,
      target: null,
      weekly_budget_minutes: 360,
      active: true,
    });
    return fn(goal.id);
  });
}

/** Moves a running session back in time, as if it had started `ago` ms ago. */
async function backdate(id: string, ago: number, length: number) {
  const start = Date.now() - ago;
  await store.updateFocusSession(id, { start_at: iso(start), end_at: iso(start + length) });
}

test("counted minutes: the time so far, capped at the planned end, none when not counted", () => {
  const s = { start_at: iso(0), end_at: iso(45 * MIN) };
  assert.equal(countedMinutes(s, 30 * MIN + 20_000, true), 30);
  assert.equal(countedMinutes(s, 30 * MIN + 40_000, true), 31);
  assert.equal(countedMinutes(s, 90 * MIN, true), 45);
  assert.equal(countedMinutes(s, 30 * MIN, false), 0);
  assert.equal(countedMinutes(s, -MIN, true), 0);
});

test("+15 moves the end and stops at four hours", () => {
  const s = { start_at: iso(0), end_at: iso(45 * MIN) };
  assert.equal(extendedEnd(s, 15), iso(60 * MIN));
  assert.equal(extendedEnd({ start_at: iso(0), end_at: iso(225 * MIN) }, 15), iso(240 * MIN));
  assert.throws(() => extendedEnd({ start_at: iso(0), end_at: iso(230 * MIN) }, 15), /at most 4 hours/);
});

test("on time is the planned end, or within 30 seconds of it", () => {
  const s = { end_at: iso(45 * MIN) };
  assert.equal(isOnTime(s, 45 * MIN - 10_000), true);
  assert.equal(isOnTime(s, 44 * MIN), false);
  assert.equal(isOnTime(s, 50 * MIN), true);
});

test("the lines: under 15 words, no dashes, the goal by its first five words", () => {
  assert.equal(doneLine(45, "University"), "Done. 45 min for University.");
  assert.equal(earlyLine(30, "University"), "Counted 30 min for University.");
  assert.equal(earlyLine(0, "University"), "Ended. Nothing counted for University.");
  // An hour or more reads as the voice writes it, never "135 min".
  assert.equal(doneLine(60, "University"), "Done. 1h for University.");
  assert.equal(earlyLine(135, "University"), "Counted 2h 15 for University.");
  assert.equal(shortGoal("Ship the company - the big launch!"), "Ship the company the big");
  for (const line of [doneLine(90, "A very long goal title with many words"), earlyLine(0, "x")]) {
    assert.ok(line.split(/\s+/).length < 15, line);
    assert.ok(!/[‐-―]/.test(line), line);
  }
});

test("quiet hours cross midnight in Athens time", () => {
  const quiet = { start: "22:00", end: "07:00" };
  // 2026-11-15 is winter time: Athens is UTC+2.
  assert.equal(inQuietHours(Date.parse("2026-11-15T21:30:00Z"), quiet), true); // 23:30
  assert.equal(inQuietHours(Date.parse("2026-11-15T04:00:00Z"), quiet), true); // 06:00
  assert.equal(inQuietHours(Date.parse("2026-11-15T10:00:00Z"), quiet), false); // 12:00
  assert.equal(inQuietHours(Date.parse("2026-11-15T10:00:00Z"), { start: "12:00", end: "12:00" }), false);
});

test("device data covers a span when Mac or iPhone attention fills half of it", () => {
  const ev = (source: Event["source"], type: Event["type"], from: number, to: number) =>
    ({ source, type, start_at: iso(from), end_at: iso(to), data: {} }) as unknown as Event;
  const span = [0, 40 * MIN] as const;
  assert.equal(coveredByDevices([ev("macos_usage", "app_usage", 0, 25 * MIN)], ...span), true);
  assert.equal(coveredByDevices([ev("macos_usage", "app_usage", 0, 10 * MIN)], ...span), false);
  // Overlaps are counted once.
  assert.equal(
    coveredByDevices(
      [ev("macos_usage", "app_usage", 0, 15 * MIN), ev("iphone_usage", "app_usage", 5 * MIN, 15 * MIN)],
      ...span,
    ),
    false,
  );
  assert.equal(coveredByDevices([ev("manual", "focus_session", 0, 40 * MIN)], ...span), false);
  assert.equal(coveredByDevices([ev("health_auto_export", "workout", 0, 30 * MIN)], ...span), true);
});

test("start makes the user's own block from now, and only one session runs at a time", () =>
  freshUser(async (goalId) => {
    const s = FocusSession.parse(await startFocus({ goal: "university", minutes: 45 }, "app"));
    assert.equal(s.status, "active");
    assert.equal(s.goal_id, goalId);
    assert.equal(s.minutes, 45);
    // No Mac data: no guard, and nothing claims one.
    assert.equal(s.guarded, false);
    const block = await store.getEvent(s.event_id as string);
    assert.equal(block?.type, "calendar_event");
    assert.equal(block?.data.goal_id, goalId);
    assert.equal(block?.end_at, s.end_at);
    await assert.rejects(
      startFocus({ goal_id: goalId, minutes: 25 }, "app"),
      /already focusing on University/,
    );
    const active = FocusActiveResponse.parse(await activeFocus());
    assert.equal(active.session?.id, s.id);
  }));

test("start uses the goal block already running instead of a second block", () =>
  freshUser(async (goalId) => {
    const now = Date.now();
    const { inserted } = await store.insertEvents([
      {
        source: "agent",
        type: "calendar_event",
        start_at: iso(now - 10 * MIN),
        end_at: iso(now + 50 * MIN),
        title: "University",
        data: { goal_id: goalId, michael: true, attendees: 0 },
        external_id: `test:${randomUUID()}`,
      },
    ]);
    const block = inserted[0] as Event;
    const s = await startFocus({ goal_id: goalId }, "app");
    assert.equal(s.event_id, block.id);
    // The rest of the block: 49 or 50 minutes.
    assert.ok(s.minutes >= 49 && s.minutes <= 50, String(s.minutes));
  }));

test("a connected Mac mutes distracting apps for the window, and +15 moves block and guard", () =>
  freshUser(async (goalId) => {
    await store.insertEvents([
      {
        source: "macos_usage",
        type: "app_usage",
        start_at: iso(Date.now() - 2 * 3600_000),
        end_at: iso(Date.now() - 2 * 3600_000 + 5 * MIN),
        title: "Xcode",
        data: { app: "Xcode", bundle_id: "com.apple.dt.Xcode" },
        external_id: `test:${randomUUID()}`,
      },
    ]);
    const s = await startFocus({ goal_id: goalId, minutes: 25 }, "app");
    assert.equal(s.guarded, true);
    assert.ok(s.apps.includes("WhatsApp"));
    const longer = await extendFocus(s.id, {});
    assert.equal(longer.minutes, 40);
    assert.equal((await store.getEvent(s.event_id as string))?.end_at, longer.end_at);
    const guards = await store.listFocusGuards({
      endsAfter: iso(Date.now()),
      startsBefore: iso(Date.now() + 86_400_000),
    });
    assert.ok(
      guards.some((g) => g.end_at === longer.end_at),
      "a guard runs to the new end",
    );
    // End early lifts every guard at once.
    await endFocus(s.id, { count: true }, "app");
    const after = await store.listFocusGuards({
      endsAfter: iso(Date.now()),
      startsBefore: iso(Date.now() + 86_400_000),
    });
    assert.equal(after.length, 0);
  }));

test("end early counts the minutes so far: the block is cut and the time is logged", () =>
  freshUser(async (goalId) => {
    const s = await startFocus({ goal_id: goalId, minutes: 45 }, "app");
    await backdate(s.id, 30 * MIN, 45 * MIN);
    const ended = FocusSession.parse(await endFocus(s.id, {}, "app"));
    assert.equal(ended.status, "ended");
    assert.equal(ended.counted_minutes, 30);
    assert.equal(ended.message, "Counted 30 min for University.");
    assert.ok(ended.log_recommendation_id);
    const log = await store.getRecommendation(ended.log_recommendation_id as string);
    assert.equal(log?.action?.kind, "log_time");
    assert.equal(log?.status, "done");
    // The block Michael made ends when the session did.
    const block = await store.getEvent(s.event_id as string);
    assert.ok(Math.abs(Date.parse(block?.end_at as string) - Date.now()) < 5_000);
    // A second end is a no-op that returns the same answer.
    const again = await endFocus(s.id, { count: false }, "app");
    assert.equal(again.counted_minutes, 30);
    // And a new session may start.
    const next = await startFocus({ goal_id: goalId, minutes: 25 }, "app");
    assert.equal(next.status, "active");
  }));

test("end early without counting logs nothing and marks the block as not done", () =>
  freshUser(async (goalId) => {
    const s = await startFocus({ goal_id: goalId, minutes: 60 }, "app");
    await backdate(s.id, 20 * MIN, 60 * MIN);
    const ended = await endFocus(s.id, { count: false }, "app");
    assert.equal(ended.counted_minutes, 0);
    assert.equal(ended.log_recommendation_id, null);
    assert.equal(ended.message, "Ended. Nothing counted for University.");
    const notes = await store.listEvents({
      from: iso(Date.now() - 3600_000),
      to: iso(Date.now() + 3600_000),
      source: ["manual"],
    });
    assert.ok(notes.some((e) => e.data.log === "didnt" && e.data.event_id === s.event_id));
  }));

test("on time: the whole length counts, the watch buzz is stored and never counts towards the cap", () =>
  freshUser(async (goalId) => {
    const s = await startFocus({ goal_id: goalId, minutes: 45 }, "app");
    await backdate(s.id, 45 * MIN + 5_000, 45 * MIN);
    // The screen coming back finishes it (the scheduler does the same with the app closed).
    const { session, last } = FocusActiveResponse.parse(await activeFocus());
    assert.equal(session, null);
    assert.equal(last?.id, s.id);
    assert.equal(last?.status, "done");
    assert.equal(last?.counted_minutes, 45);
    assert.equal(last?.message, "Done. 45 min for University.");
    assert.ok(last?.log_recommendation_id);
    const nudges = await store.listNudges({
      from: iso(Date.now() - 86_400_000),
      to: iso(Date.now() + 60_000),
    });
    const buzz = nudges.find((n) => n.kind === "focus_done");
    assert.equal(buzz?.text, "Done. 45 min for University.");
    assert.equal(countsTowardsCap(buzz?.status ?? "queued", buzz?.kind), false);
  }));

test("the finisher ends due sessions as their own user", async () => {
  let id = "";
  const user = randomUUID();
  await runAsUser(user, async () => {
    await withoutInstructions(store);
    const goal = await store.createGoal({
      category: "business",
      title: "The company",
      description: null,
      target: null,
      weekly_budget_minutes: 600,
      active: true,
    });
    const s = await startFocus({ goal_id: goal.id, minutes: 25 }, "app");
    id = s.id;
    await backdate(s.id, 26 * MIN, 25 * MIN);
  });
  assert.ok((await finishDueFocusSessions()) >= 1);
  const after = await runAsUser(user, () => store.getFocusSession(id));
  assert.equal(after?.status, "done");
  assert.equal(after?.counted_minutes, 25);
});
