import assert from "node:assert/strict";
import { test } from "node:test";
import { EventInput, GoalCreate, voiceProblems } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { phoneLive } from "../ingest/phone-live";
import { testNudge } from "../routes/nudges";
import { store } from "../store";
import { engineWindow } from "./engine";

const MINUTE = 60_000;
const USER = "00000000-0000-4000-8000-00000000ab38";

test("the phone, live, reaches the nudge: five opens in a running block, then the line by name", async (t) => {
  const now = Date.now();
  // A block is read inside its local day: in the first minutes after midnight this one would be cut.
  if (now - Date.parse(engineWindow(new Date(now).toISOString()).dayStart) < 10 * MINUTE) {
    t.skip("just after midnight");
    return;
  }
  await runAsUser(USER, async () => {
    // A fresh account starts with example goals; this test speaks about its own only.
    for (const g of await store.listGoals()) await store.updateGoal(g.id, { active: false });
    const goal = await store.createGoal(
      GoalCreate.parse({ category: "business", title: "Ship the pitch", weekly_budget_minutes: 600 }),
    );
    await store.insertEvents([
      EventInput.parse({
        source: "google_calendar",
        type: "calendar_event",
        start_at: new Date(now - 8 * MINUTE).toISOString(),
        end_at: new Date(now + 30 * MINUTE).toISOString(),
        title: "Pitch",
        data: { goal_id: goal.id },
        external_id: "realtime-io-test-block",
      }),
    ]);
    // Nothing from the phone yet: the named trigger has nothing to say, so the usual test line goes.
    const before = await testNudge("phone_block");
    assert.doesNotMatch(before.text, /phone opened/);

    for (const ago of [7, 6, 4.5, 3, 1.5]) {
      phoneLive.record(USER, { app: "Instagram", action: "open", at: undefined }, now - ago * MINUTE);
    }
    const res = await testNudge("phone_block");
    assert.match(res.text, /^Your phone opened 5 times in Ship the pitch\. Put it down until \d\d:\d\d\.$/);
    assert.deepEqual(voiceProblems(res.text), []);
    assert.equal(res.nudge.kind, "focus_drift");
    assert.equal(res.nudge.status, "test");
    assert.equal(res.nudge.goal_id, goal.id);

    // The same signals, asked as the late line: the minutes of the last hour, from the first open.
    const late = await testNudge("late_phone");
    assert.match(late.text, /^\d+ minutes on your phone since \d\d:\d\d\. Stop here\./);
    assert.equal(late.nudge.kind, "wind_down");
  });
  phoneLive.clear();
});

test("POST /v1/nudges/test takes ?trigger= and refuses anything else", async () => {
  const headers = { Authorization: "Bearer dev-key" };
  const ok = await app.request("/v1/nudges/test?trigger=late_phone", { method: "POST", headers });
  assert.equal(ok.status, 200);
  const bad = await app.request("/v1/nudges/test?trigger=everything", { method: "POST", headers });
  assert.equal(bad.status, 400);
});

test("an app open through the webhook is kept live, the same app twice as two opens", async () => {
  phoneLive.clear();
  const headers = { Authorization: "Bearer dev-key", "content-type": "application/json" };
  const post = (name: string) =>
    app.request("/v1/webhooks/ios-shortcuts", {
      method: "POST",
      headers,
      body: JSON.stringify({ app: name, action: "open" }),
    });
  // The API key is the demo account.
  const id = env.DEMO_USER_ID;
  assert.equal((await post("Instagram")).status, 200);
  assert.equal((await post("Instagram")).status, 200);
  // The same app twice: one held open for the pairer, two opens here.
  assert.equal(phoneLive.since(id, 0).length, 2);
  phoneLive.clear();
});
