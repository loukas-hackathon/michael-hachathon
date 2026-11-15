import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceProblems } from "@michael/shared";
import {
  SCRIPT_DONE,
  SCRIPT_DONE_EMPTY,
  SCRIPT_QUESTIONS,
  scriptTurn,
  splitLine,
  userWords,
  withoutGreeting,
} from "./onboarding-script";

const q = (i: number) => (SCRIPT_QUESTIONS[i] as { ask: string }).ask;

test("the script opens with the first question and walks the three in order", () => {
  const first = scriptTurn([]);
  assert.equal(first.done, false);
  assert.match(first.line, new RegExp(q(0).replace("?", "\\?")));
  const second = scriptTurn([
    { role: "michael", text: first.line },
    { role: "user", text: "the startup" },
  ]);
  assert.ok(second.line.startsWith("Got it."));
  assert.ok(second.line.includes(q(1)));
  const third = scriptTurn([
    { role: "michael", text: first.line },
    { role: "user", text: "the startup" },
    { role: "michael", text: second.line },
    { role: "user", text: "", skipped: true },
  ]);
  assert.ok(third.line.startsWith("Fine,"));
  assert.ok(third.line.includes(q(2)));
});

test("the script never asks what the conversation already covered, and knows when to stop", () => {
  // The model asked the first two, then failed: only the third is left.
  const next = scriptTurn([
    { role: "michael", text: "What are you working towards?" },
    { role: "user", text: "a marathon" },
    { role: "michael", text: "How many hours a week can you give it?" },
    { role: "user", text: "six" },
  ]);
  assert.ok(next.line.includes(q(2)));
  const done = scriptTurn([
    { role: "michael", text: q(0) },
    { role: "user", text: "a marathon" },
    { role: "michael", text: q(1) },
    { role: "user", text: "", skipped: true },
    { role: "michael", text: q(2) },
    { role: "user", text: "my phone" },
  ]);
  assert.deepEqual(done, { line: SCRIPT_DONE, done: true, from_calendar: false, source: "script" });
  assert.equal(scriptTurn([{ role: "user", text: "That's it." }]).done, true);
  const nothing = scriptTurn(
    SCRIPT_QUESTIONS.map(() => ({ role: "user" as const, text: "", skipped: true })),
  );
  assert.equal(nothing.line, SCRIPT_DONE_EMPTY);
});

test("every script line is in Michael's voice", () => {
  const lines = [SCRIPT_DONE, SCRIPT_DONE_EMPTY, scriptTurn([]).line];
  for (let i = 1; i < 3; i++)
    lines.push(scriptTurn(Array.from({ length: i }, () => ({ role: "user" as const, text: "yes" }))).line);
  for (const line of lines) {
    assert.deepEqual(voiceProblems(line), [], line);
    assert.ok(line.length <= 320);
  }
});

test("splitLine puts the question first and the reaction and hint around it", () => {
  assert.deepEqual(splitLine("Got it. What would make this a good week? Say roughly how much time."), {
    before: "Got it.",
    ask: "What would make this a good week?",
    after: "Say roughly how much time.",
  });
  assert.deepEqual(splitLine("Gym three times. Is that normal? What would you change?"), {
    before: "Gym three times.",
    ask: "Is that normal? What would you change?",
    after: "",
  });
  assert.deepEqual(splitLine("That's plenty. Here's what I heard."), {
    before: "",
    ask: "That's plenty. Here's what I heard.",
    after: "",
  });
});

test("withoutGreeting drops a second hello, never the question", () => {
  assert.equal(
    withoutGreeting("Hi, I'm Michael. Gym 3 times a week. Is that the plan?"),
    "Gym 3 times a week. Is that the plan?",
  );
  assert.equal(withoutGreeting("Hello. I'm Michael. What matters most?"), "What matters most?");
  assert.equal(
    withoutGreeting("Got it. What would make this a good week?"),
    "Got it. What would make this a good week?",
  );
  assert.equal(withoutGreeting("I'm Michael."), "I'm Michael.");
});

test("userWords joins what was said and leaves skips out", () => {
  assert.equal(
    userWords([
      { role: "michael", text: "Q" },
      { role: "user", text: " deep work " },
      { role: "user", text: "", skipped: true },
      { role: "user", text: "my phone" },
    ]),
    "deep work\nmy phone",
  );
});
