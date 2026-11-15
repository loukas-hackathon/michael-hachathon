import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "./env";
import { runNudgeChecks, SLOW_EVERY_MS } from "./scheduler";

test("a tick never stacks on the one before: the second is skipped while the first runs", async () => {
  const first = runNudgeChecks();
  // Started in the same turn of the loop, so the first cannot have finished.
  const second = await runNudgeChecks();
  assert.equal(second, null);
  assert.ok(Array.isArray(await first));
  // Once it is done the next tick runs again.
  assert.ok(Array.isArray(await runNudgeChecks()));
});

test("nudge checks default to every minute; the web warm ping and the slow work keep 5 minutes", () => {
  // With no variable set, this is the default production gets.
  if (process.env.SCHEDULER_INTERVAL_MINUTES === undefined) assert.equal(env.SCHEDULER_INTERVAL_MINUTES, 1);
  assert.equal(SLOW_EVERY_MS, 5 * 60_000);
});
