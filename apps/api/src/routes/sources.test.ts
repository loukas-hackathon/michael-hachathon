import assert from "node:assert/strict";
import { test } from "node:test";
import { SourcesStatusResponse } from "@michael/shared";
import { app } from "../app";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };

test("sources status: every source listed, last event time once one arrives", async () => {
  const read = async () => {
    const res = await app.request("/v1/sources/status", { headers: auth });
    assert.equal(res.status, 200);
    return SourcesStatusResponse.parse(await res.json());
  };
  const before = await read();
  assert.ok(before.sources.some((s) => s.source === "health_auto_export"));
  assert.equal(before.sources.find((s) => s.source === "owntracks")?.last_event_at, null);

  const res = await app.request("/v1/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      source: "owntracks",
      type: "location",
      start_at: "2026-11-14T07:00:00+02:00",
      title: "Sources status test",
      external_id: "sources-status-test-1",
    }),
  });
  assert.equal(res.status, 201);

  const after = await read();
  const loc = after.sources.find((s) => s.source === "owntracks");
  assert.equal(loc?.enabled, true);
  assert.equal(loc?.collecting, true);
  assert.ok(loc?.last_event_at && Date.now() - Date.parse(loc.last_event_at) < 60_000);
});
