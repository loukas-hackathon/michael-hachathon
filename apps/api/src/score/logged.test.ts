import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type Event, type Goal, Score } from "@michael/shared";
import { APPS, calendar, goal, mac, T } from "../patterns/testkit";
import { buildScore } from "./score";

// The user's word in the score (#317): logged done time and settled blocks. Times are made up and
// worked out by hand (Athens winter time, +02:00).

const BATH: Goal = {
  ...goal("personal", "20000000-0000-4000-8000-000000000001", "Everything bath"),
  weekly_budget_minutes: 60,
};
const TRI: Goal = {
  ...goal("gym", "20000000-0000-4000-8000-000000000002", "Triathlon"),
  target: { calendar_titles: ["Gym"] },
  weekly_budget_minutes: 540,
};
const COMPANY: Goal = {
  ...goal("work", "20000000-0000-4000-8000-000000000003", "The company"),
  target: { calendar_titles: ["Deep work"] },
  weekly_budget_minutes: 480,
};
const GOALS = [BATH, TRI, COMPANY];

const done = (g: Goal, start: string, end: string, data: Record<string, unknown> = {}): Event => ({
  id: randomUUID(),
  source: "manual",
  type: "focus_session",
  start_at: T(start),
  end_at: T(end),
  title: g.title,
  data: { log: "done", goal_id: g.id, recommendation_id: randomUUID(), ...data },
  external_id: null,
  created_at: T(end),
});

const didnt = (g: Goal, block: Event, reason?: string): Event => ({
  id: randomUUID(),
  source: "manual",
  type: "note",
  start_at: block.start_at,
  end_at: block.end_at,
  title: `Didn't do ${block.title}`,
  data: { log: "didnt", goal_id: g.id, event_id: block.id, reason: reason ?? null },
  external_id: null,
  created_at: block.end_at as string,
});

const score = (events: Event[], now: string, date = "2026-11-12") =>
  Score.parse(buildScore(events, GOALS, { date, now: T(now) }));
const row = (s: Score, g: Goal) => s.goals.find((r) => r.goal_id === g.id);

test("the bath: 40 logged minutes with no block are confirmed goal time of their own", () => {
  const s = score([done(BATH, "2026-11-12 13:00", "2026-11-12 13:40", { note: "Bath" })], "2026-11-12 15:00");
  const bath = row(s, BATH);
  assert.equal(bath?.spent_minutes, 40);
  assert.equal(bath?.unverified_minutes, 0);
  assert.equal(bath?.minutes_left, 20);
  const [piece] = s.day.blocks;
  assert.equal(piece?.matched_by, "logged");
  assert.equal(piece?.settled, "did");
  assert.equal(piece?.title, "Bath");
  assert.deepEqual(
    [piece?.planned_minutes, piece?.elapsed_minutes, piece?.spent_minutes, piece?.lost_minutes],
    [40, 40, 40, 0],
  );
  assert.ok(piece?.ticks.every((t) => t === "spent"));
  // Logged time leaves time won back alone: it rests on the data only.
  assert.equal(s.day.time_won_back.minutes, 0);
});

test("logged time inside a block of the same goal confirms it instead of counting twice", () => {
  const gym = calendar("Gym", T("2026-11-12 07:00"), T("2026-11-12 08:00"));
  const s = score([gym, done(TRI, "2026-11-12 07:00", "2026-11-12 07:45")], "2026-11-12 09:00");
  const tri = row(s, TRI);
  // The block's 60 minutes, not 60 + 45; 45 of them confirmed, 15 still unverified.
  assert.equal(tri?.spent_minutes, 60);
  assert.equal(tri?.unverified_minutes, 15);
  assert.equal(s.day.blocks.length, 1);
  assert.equal(s.day.blocks[0]?.matched_by, "calendar_titles");
  assert.equal(s.day.blocks[0]?.settled, undefined);
});

test("only the part outside every block of its goal becomes its own piece", () => {
  const gym = calendar("Gym", T("2026-11-12 07:00"), T("2026-11-12 08:00"));
  const s = score([gym, done(TRI, "2026-11-12 07:30", "2026-11-12 08:30")], "2026-11-12 09:00");
  assert.equal(row(s, TRI)?.spent_minutes, 90);
  const logged = s.day.blocks.find((b) => b.matched_by === "logged");
  assert.equal(logged?.start_at, new Date(T("2026-11-12 08:00")).toISOString());
  assert.equal(logged?.spent_minutes, 30);
});

test("the user's word beats a distractor: logged minutes inside a block are never lost", () => {
  const work = calendar("Deep work", T("2026-11-12 10:00"), T("2026-11-12 11:00"));
  const chat = mac(APPS.chat, T("2026-11-12 10:00"), T("2026-11-12 10:30"));
  const without = score([work, chat], "2026-11-12 12:00");
  assert.equal(row(without, COMPANY)?.lost_minutes, 30);
  const s = score([work, chat, done(COMPANY, "2026-11-12 10:00", "2026-11-12 10:20")], "2026-11-12 12:00");
  assert.equal(row(s, COMPANY)?.lost_minutes, 10);
  assert.equal(
    s.day.blocks[0]?.lost.reduce((t, l) => t + l.minutes, 0),
    10,
  );
});

test("past only: logged time after now is left out", () => {
  const s = score(
    [done(BATH, "2026-11-12 13:00", "2026-11-12 14:00"), done(BATH, "2026-11-12 18:00", "2026-11-12 19:00")],
    "2026-11-12 13:30",
  );
  assert.equal(row(s, BATH)?.spent_minutes, 30);
  assert.equal(s.day.ahead_minutes, 0);
});

test("Didn't: a settled block is all lost, and says so", () => {
  const gym = calendar("Gym", T("2026-11-12 07:00"), T("2026-11-12 08:00"));
  const s = score([gym, didnt(TRI, gym, "knee")], "2026-11-12 09:00");
  const [block] = s.day.blocks;
  assert.equal(block?.settled, "didnt");
  assert.deepEqual([block?.spent_minutes, block?.lost_minutes, block?.score_pct], [0, 60, 0]);
  assert.ok(block?.ticks.every((t) => t === "lost"));
});

test("Did it, partly: the minutes said are confirmed, the rest of the block is lost", () => {
  const gym = calendar("Gym", T("2026-11-12 07:00"), T("2026-11-12 08:00"));
  const part = done(TRI, "2026-11-12 07:00", "2026-11-12 07:40", { event_id: gym.id });
  const s = score([gym, part], "2026-11-12 09:00");
  const [block] = s.day.blocks;
  assert.equal(s.day.blocks.length, 1);
  assert.equal(block?.settled, "did");
  assert.deepEqual([block?.spent_minutes, block?.lost_minutes, block?.unverified_minutes], [40, 20, 0]);
});

test("Did it, all of it: the block is confirmed", () => {
  const gym = calendar("Gym", T("2026-11-12 07:00"), T("2026-11-12 08:00"));
  const all = done(TRI, "2026-11-12 07:00", "2026-11-12 08:00", { event_id: gym.id });
  const s = score([gym, all], "2026-11-12 09:00");
  assert.deepEqual(
    [s.day.blocks[0]?.spent_minutes, s.day.blocks[0]?.unverified_minutes, s.day.blocks[0]?.lost_minutes],
    [60, 0, 0],
  );
  assert.equal(s.day.score_pct, 100);
});

test("logged time for a paused goal or another week does not count", () => {
  const paused = { ...BATH, active: false };
  const s = Score.parse(
    buildScore(
      [
        done(BATH, "2026-11-12 13:00", "2026-11-12 13:40"),
        done(BATH, "2026-11-02 13:00", "2026-11-02 13:40"),
      ],
      [paused, TRI],
      { date: "2026-11-12", now: T("2026-11-12 15:00") },
    ),
  );
  assert.equal(s.spent_minutes, 0);
  const active = score([done(BATH, "2026-11-02 13:00", "2026-11-02 13:40")], "2026-11-12 15:00");
  assert.equal(row(active, BATH)?.spent_minutes, 0);
});
