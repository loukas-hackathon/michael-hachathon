import assert from "node:assert/strict";
import { test } from "node:test";
import { IngestResponse, PrivacyState, SourceSetting } from "@michael/shared";
import { app } from "../app";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });

const event = (source: string, n: number) => ({
  source,
  type: "app_usage",
  start_at: `2026-11-14T10:0${n}:00+02:00`,
  title: `Privacy test ${source} ${n}`,
  external_id: `privacy-test-${source}-${n}`,
});

const ingest = async (body: unknown, path = "/v1/events") => {
  const res = await call("POST", path, body);
  assert.equal(res.status, 201);
  return IngestResponse.parse(await res.json());
};

// One test, in order: the store is shared per user and these steps build on each other.
test("privacy: opt in, source switch and off the record decide what ingest stores", async () => {
  // Every source listed, all off until connected.
  let res = await call("GET", "/v1/privacy");
  assert.equal(res.status, 200);
  let state = PrivacyState.parse(await res.json());
  assert.equal(state.off_the_record, false);
  assert.equal(state.since, null);
  assert.equal(state.sources.find((s) => s.source === "chrome")?.enabled, false);

  // A source's first event is its opt in.
  assert.equal((await ingest(event("chrome", 1))).inserted, 1);
  state = PrivacyState.parse(await (await call("GET", "/v1/privacy")).json());
  assert.equal(state.sources.find((s) => s.source === "chrome")?.enabled, true);

  // Switched off: dropped and counted.
  res = await call("PATCH", "/v1/privacy/sources/chrome", { enabled: false });
  assert.equal(res.status, 200);
  assert.equal(SourceSetting.parse(await res.json()).enabled, false);
  let out = await ingest(event("chrome", 2));
  assert.deepEqual([out.inserted, out.ignored], [0, 1]);

  // Off the record: nothing collected, except what the user types in themself.
  res = await call("PUT", "/v1/privacy/off-the-record", { off_the_record: true });
  state = PrivacyState.parse(await res.json());
  assert.equal(state.off_the_record, true);
  assert.ok(state.since);
  out = await ingest({ events: [event("macos_usage", 3), event("manual", 4)] }, "/v1/events/batch");
  assert.deepEqual([out.inserted, out.ignored], [1, 1]);

  // Back on the record: collecting again from enabled sources.
  state = PrivacyState.parse(
    await (await call("PUT", "/v1/privacy/off-the-record", { off_the_record: false })).json(),
  );
  assert.deepEqual([state.off_the_record, state.since], [false, null]);
  out = await ingest(event("macos_usage", 5));
  assert.equal(out.inserted, 1);
});

test("privacy: bad source and bad body are rejected", async () => {
  assert.equal((await call("PATCH", "/v1/privacy/sources/telepathy", { enabled: true })).status, 400);
  assert.equal((await call("PUT", "/v1/privacy/off-the-record", { off_the_record: "yes" })).status, 400);
  assert.equal((await app.request("/v1/privacy")).status, 401);
});
