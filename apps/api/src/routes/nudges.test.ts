import assert from "node:assert/strict";
import { test } from "node:test";
import { countsTowardsCap, NudgeCheckResult, NudgesResponse, NudgeTestResult } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { store } from "../store";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string) => app.request(path, { method, headers: auth });

test("nudges/test: stored as test, visible to GET /v1/nudges, outside the 5 a day", async () => {
  const before = NudgesResponse.parse(await (await call("GET", "/v1/nudges")).json()).nudges;

  // Pressed twice on stage: both stored, the daily dedupe never swallows the second.
  const first = NudgeTestResult.parse(await (await call("POST", "/v1/nudges/test")).json());
  const second = NudgeTestResult.parse(await (await call("POST", "/v1/nudges/test")).json());
  assert.equal(first.nudge.status, "test");
  assert.equal(first.nudge.text, first.text);
  assert.notEqual(first.nudge.id, second.nudge.id);

  const after = NudgesResponse.parse(await (await call("GET", "/v1/nudges")).json()).nudges;
  assert.equal(after.length, before.length + 2);
  assert.equal(after.at(-1)?.id, second.nudge.id);

  // The engine's own count leaves them out.
  const check = NudgeCheckResult.parse(await (await call("POST", "/v1/nudges/check")).json());
  const counted = before.filter((n) => countsTowardsCap(n.status, n.kind)).length;
  const added = check.nudge && countsTowardsCap(check.nudge.status, check.nudge.kind) ? 1 : 0;
  assert.equal(check.sent_today, counted + added);

  // Another user never sees them.
  const other = await runAsUser("00000000-0000-4000-8000-00000000ff11", () =>
    store.listNudges({ from: new Date(0).toISOString(), to: new Date(Date.now() + 60_000).toISOString() }),
  );
  assert.equal(other.length, 0);
});
