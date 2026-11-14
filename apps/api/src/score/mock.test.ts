import assert from "node:assert/strict";
import { test } from "node:test";
import { mockScore, Score } from "@michael/shared";
import { mockScoreScenario } from "./mock-scenario";
import { buildScore } from "./score";

test("mockScore is exactly what the score returns for the mock scenario", () => {
  const scenario = mockScoreScenario();
  const built = Score.parse(buildScore(scenario.events, scenario.goals, scenario));
  assert.deepEqual(built, Score.parse(mockScore));
});

test("mockScore tells the web sample day: 82% so far, 64% for the week, 47 minutes won back", () => {
  const { day } = mockScore;
  assert.deepEqual(
    [day.planned_minutes, day.spent_minutes, day.lost_minutes, day.ahead_minutes, day.score_pct],
    [310, 213, 47, 50, 82],
  );
  assert.equal(mockScore.score_pct, 64);
  assert.equal(day.time_won_back_minutes, 47);
  assert.equal(mockScore.time_won_back_minutes, 47);
  assert.deepEqual(
    day.blocks.map((b) => [b.title, b.ticks.length, b.lost.map((l) => `${l.what} ${l.minutes}`)]),
    [
      ["Deep work", 24, ["WhatsApp 4", "Mail 5"]],
      ["Deep work", 12, ["Instagram 19"]],
      ["Study", 18, ["WhatsApp 2", "WhatsApp 11", "Instagram 2", "WhatsApp 1", "Instagram 2", "WhatsApp 1"]],
      ["Run", 8, []],
    ],
  );
});
