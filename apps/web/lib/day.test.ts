import assert from "node:assert/strict";
import { test } from "node:test";
import { aheadOf, cardMomentAt, type GoalBlock, titleMomentAt } from "./day";

// Athens is UTC+2 in November.
const at = (hhmm: string) => new Date(`2026-11-15T${hhmm}:00+02:00`).toISOString();

test("the title is Today at night, Morning from 05:00, Today from 11:00, Evening from 20:00", () => {
  assert.equal(titleMomentAt(at("00:00")), "today");
  assert.equal(titleMomentAt(at("01:43")), "today");
  assert.equal(titleMomentAt(at("04:59")), "today");
  assert.equal(titleMomentAt(at("05:00")), "morning");
  assert.equal(titleMomentAt(at("10:59")), "morning");
  assert.equal(titleMomentAt(at("11:00")), "today");
  assert.equal(titleMomentAt(at("19:59")), "today");
  assert.equal(titleMomentAt(at("20:00")), "evening");
  assert.equal(titleMomentAt(at("23:59")), "evening");
});

test("the moment card keeps the title's hours, and the Morning plan is still on offer at night", () => {
  assert.equal(cardMomentAt(at("01:43")), "morning");
  assert.equal(cardMomentAt(at("10:59")), "morning");
  assert.equal(cardMomentAt(at("11:00")), null);
  assert.equal(cardMomentAt(at("19:59")), null);
  assert.equal(cardMomentAt(at("20:00")), "evening");
});

test("title and card never name different parts of the day", () => {
  for (let h = 0; h < 24; h++) {
    const iso = at(`${String(h).padStart(2, "0")}:30`);
    const title = titleMomentAt(iso);
    const card = cardMomentAt(iso);
    if (title === "morning") assert.equal(card, "morning");
    if (title === "evening") assert.equal(card, "evening");
    if (card === "evening") assert.equal(title, "evening");
  }
});

test("the clock follows the user's timezone", () => {
  assert.equal(titleMomentAt("2026-11-15T06:00:00.000Z", "Europe/Athens"), "morning");
  assert.equal(titleMomentAt("2026-11-15T06:00:00.000Z", "America/New_York"), "today");
});

// #434: the headline before anything is scored speaks only about what is really ahead.
const block = (id: string, start: string, end: string): GoalBlock => ({
  id,
  goalId: "g",
  title: "University",
  start: at(start),
  end: at(end),
  interruptions: [],
});
const idOf = (a: ReturnType<typeof aheadOf>) => [a.kind, a.kind === "none" ? null : a.block.id];

test("a block not started yet is the first one ahead", () => {
  assert.deepEqual(idOf(aheadOf({ now: at("09:00"), blocks: [block("a", "10:00", "11:00")] })), [
    "first",
    "a",
  ]);
});

test("a Focus ended in its first minute leaves nothing upcoming", () => {
  // Started 11:17 and ended at once: the block was cut to 11:17 to 11:18.
  const leftover = block("f", "11:17", "11:18");
  const halfway = new Date(Date.parse(at("11:17")) + 30_000).toISOString();
  assert.equal(aheadOf({ now: halfway, blocks: [leftover] }).kind, "none");
  assert.equal(aheadOf({ now: at("11:19"), blocks: [leftover] }).kind, "none");
  assert.deepEqual(idOf(aheadOf({ now: halfway, blocks: [leftover, block("u", "14:00", "15:00")] })), [
    "next",
    "u",
  ]);
});

test("a block running now is said as running, not as starting", () => {
  const blocks = [block("a", "10:00", "11:00"), block("b", "14:00", "15:00")];
  assert.deepEqual(idOf(aheadOf({ now: at("10:30"), blocks })), ["running", "a"]);
});
