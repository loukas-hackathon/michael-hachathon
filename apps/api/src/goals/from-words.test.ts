import assert from "node:assert/strict";
import { test } from "node:test";
import { GoalWordsResponse, voiceProblems } from "@michael/shared";
import { FakeModelClient, useModelClient } from "../analysis/model";
import { clauses, cleanGoals, goalsFromWords, heardLine, minutesIn, readByRules } from "./from-words";

// Goals from the user's own words: messy speech in, at most five goals and a few notes out.

test("clauses cut speech on stops, commas and joining words", () => {
  assert.deepEqual(clauses("the startup mostly, and the gym. I keep losing nights on my phone"), [
    "the startup mostly",
    "the gym",
    "I keep losing nights on my phone",
  ]);
});

test("the time a clause names, per week", () => {
  const gym = { session: 60, title: "Training" };
  assert.equal(minutesIn("gym three times a week", gym), 180);
  assert.equal(minutesIn("two hours a day", { session: 120, title: "Deep work" }), 14 * 60);
  assert.equal(minutesIn("ten hours on the product", { session: 120, title: "Ship" }), 600);
  assert.equal(minutesIn("sleep 8 hours", { session: 0, title: "Sleep" }), 8 * 60 * 7);
  assert.equal(minutesIn("more gym", gym), null);
});

test("the word lists read a messy transcript into goals and notes", () => {
  const read = readByRules(
    "um so mostly the startup, we launch in December, ten hours of deep work, and I want to get back to the gym three times a week. I lose my evenings on my phone. also sleep, like 7 hours",
  );
  const titles = read.goals.map((g) => g.title);
  assert.deepEqual(titles, ["Ship the product", "Deep work", "Training", "Sleep"]);
  const training = read.goals.find((g) => g.title === "Training");
  assert.equal(training?.weekly_budget_minutes, 180);
  assert.equal(training?.estimated, false);
  assert.equal(read.goals.find((g) => g.title === "Deep work")?.weekly_budget_minutes, 600);
  const sleep = read.goals.find((g) => g.title === "Sleep");
  assert.equal(sleep?.target.kind, "target");
  assert.equal(sleep?.target.sleep_hours, 7);
  assert.deepEqual(read.notes, ["I lose my evenings on my phone"]);
});

test("a second clause gives the first its hours", () => {
  const read = readByRules("gym. three times a week at the gym");
  assert.equal(read.goals.length, 1);
  assert.equal(read.goals[0]?.weekly_budget_minutes, 180);
});

test("nothing usable: no goals and Michael asks", () => {
  const read = readByRules("hmm not sure really");
  assert.equal(read.goals.length, 0);
  assert.match(heardLine(read.goals), /\?$/);
});

test("the template line keeps the voice rules", () => {
  const read = readByRules("study for my exams, gym, family time");
  const line = heardLine(read.goals);
  assert.deepEqual(voiceProblems(line), []);
  assert.match(line, /^I heard three goals\./);
});

test("the model's goals are cleaned: bad rows dropped, repeats merged, sleep set from hours", () => {
  const goals = cleanGoals([
    {
      title: "Ship the beta",
      category: "business",
      weekly_budget_minutes: 613,
      target: { kind: "time", calendar_titles: ["Build"] },
      evidence: "the beta",
      estimated: false,
    },
    {
      title: "ship the beta",
      category: "business",
      weekly_budget_minutes: 60,
      target: { kind: "time" },
      evidence: "x",
      estimated: true,
    },
    { title: "", category: "health" },
    {
      title: "Sleep",
      category: "health",
      weekly_budget_minutes: 1,
      target: { kind: "target", sleep_hours: 8 },
      evidence: "sleep 8",
      estimated: false,
    },
    {
      title: "Dancing",
      category: "fun",
      weekly_budget_minutes: 60,
      target: { kind: "time" },
      evidence: "x",
      estimated: true,
    },
  ]);
  assert.deepEqual(
    goals.map((g) => [g.title, g.weekly_budget_minutes]),
    [
      ["Ship the beta", 600],
      ["Sleep", 8 * 60 * 7],
    ],
  );
});

test("with the model: its reading and its line, checked", async () => {
  useModelClient(
    new FakeModelClient([
      JSON.stringify({
        goals: [
          {
            title: "Fundraising",
            category: "business",
            weekly_budget_minutes: 300,
            target: { kind: "time", calendar_titles: ["Investor"] },
            evidence: "investors in December",
            estimated: true,
          },
        ],
        notes: ["Loses evenings to the phone"],
        line: "One goal: Fundraising, 5 hours a week. I set the hours, check them.",
      }),
    ]),
  );
  try {
    const r = GoalWordsResponse.parse(await goalsFromWords("investors in december, phone eats my evenings"));
    assert.equal(r.source, "model");
    assert.equal(r.goals[0]?.title, "Fundraising");
    assert.deepEqual(r.notes, ["Loses evenings to the phone"]);
    assert.match(r.line, /^One goal/);
  } finally {
    useModelClient(null);
  }
});

test("a model line that breaks the voice rules gives way to the template", async () => {
  useModelClient(
    new FakeModelClient([
      JSON.stringify({
        goals: [
          {
            title: "Training",
            category: "health",
            weekly_budget_minutes: 240,
            target: { kind: "time" },
            evidence: "gym",
            estimated: true,
          },
        ],
        notes: [],
        line: "Amazing! Let's crush it!",
      }),
    ]),
  );
  try {
    const r = await goalsFromWords("gym");
    assert.equal(r.line, heardLine(r.goals));
  } finally {
    useModelClient(null);
  }
});

test("the model fails: the word lists answer", async () => {
  useModelClient(new FakeModelClient([new Error("down")]));
  try {
    const r = await goalsFromWords("gym twice a week and reading");
    assert.equal(r.source, "rules");
    assert.deepEqual(
      r.goals.map((g) => g.title),
      ["Training", "Reading"],
    );
  } finally {
    useModelClient(null);
  }
});

test("each answer on its own line stays its own clause", () => {
  const read = readByRules("gym three times a week, and sleep 7 hours\nI lose my evenings on my phone");
  assert.deepEqual(
    read.goals.map((g) => g.title),
    ["Training", "Sleep"],
  );
  assert.deepEqual(read.notes, ["I lose my evenings on my phone"]);
});
