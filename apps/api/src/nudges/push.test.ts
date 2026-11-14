import assert from "node:assert/strict";
import { test } from "node:test";
import { NudgeTestResult, PushConfig } from "@michael/shared";
import { generateVAPIDKeys } from "web-push";
import { app } from "../app";
import { runAsUser } from "../context";
import { runNudgeChecks } from "../scheduler";
import { store } from "../store";
import { configurePush, type PushSender } from "./push";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });

const device = (n: number) => ({
  endpoint: `https://web.push.apple.com/test-device-${n}`,
  keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
});

test("push: subscribe, test nudge reaches every device, gone devices are forgotten", async () => {
  const keys = generateVAPIDKeys();
  const sent: { endpoint: string; payload: unknown }[] = [];
  const sender: PushSender = async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    if (sub.endpoint.endsWith("-2")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    return { statusCode: 201 };
  };
  configurePush({ vapid: { ...keys, subject: "mailto:test@example.com" }, sender });

  let res = await call("GET", "/v1/push");
  const before = PushConfig.parse(await res.json());
  assert.equal(before.enabled, true);
  assert.equal(before.public_key, keys.publicKey);

  // Only https push services.
  res = await call("POST", "/v1/push/subscriptions", { ...device(9), endpoint: "http://evil.example/x" });
  assert.equal(res.status, 400);

  for (const n of [1, 2]) {
    res = await call("POST", "/v1/push/subscriptions", device(n));
    assert.equal(res.status, 201);
  }
  assert.equal(PushConfig.parse(await res.json()).devices, before.devices + 2);

  res = await call("POST", "/v1/nudges/test");
  assert.equal(res.status, 200);
  const result = NudgeTestResult.parse(await res.json());
  assert.equal(result.devices, before.devices + 2);
  assert.equal(result.delivered, before.devices + 1);
  const mine = sent.find((s) => s.endpoint === device(1).endpoint);
  const payload = mine?.payload as { title: string; body: string; url: string };
  assert.equal(payload.title, "Michael");
  assert.equal(payload.body, result.text);
  assert.equal(payload.url, "/");

  // The 410 device is gone; another user never sees this user's devices.
  const after = PushConfig.parse(await (await call("GET", "/v1/push")).json());
  assert.equal(after.devices, before.devices + 1);
  const other = await runAsUser("00000000-0000-4000-8000-00000000ff01", () => store.listPushDevices());
  assert.equal(other.length, 0);

  res = await call("DELETE", "/v1/push/subscriptions", { endpoint: device(1).endpoint });
  assert.equal(PushConfig.parse(await res.json()).devices, before.devices);
  configurePush({ vapid: null });
});

test("scheduler: checks only active users, each as themself, and respects off the record", async () => {
  const active = "00000000-0000-4000-8000-00000000ff02";
  const idle = "00000000-0000-4000-8000-00000000ff03";
  await runAsUser(active, async () => {
    await store.insertEvents([
      {
        source: "manual",
        type: "note",
        start_at: new Date().toISOString(),
        end_at: null,
        title: "Scheduler test",
        data: {},
        external_id: "scheduler-test-1",
      },
    ]);
    await store.setOffTheRecord(true);
  });

  const checks = await runNudgeChecks();
  assert.ok(checks);
  const ids = checks.map((c) => c.userId);
  assert.ok(ids.includes(active));
  assert.ok(!ids.includes(idle));
  const mine = checks.find((c) => c.userId === active);
  assert.equal(mine?.error, undefined);
  assert.equal(mine?.result?.skipped, "off_the_record");
  assert.equal(mine?.result?.nudge, null);
});
