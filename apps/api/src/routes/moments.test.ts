import assert from "node:assert/strict";
import { test } from "node:test";
import { Moment } from "@michael/shared";
import { app } from "../app";

const auth = { Authorization: "Bearer dev-key" };

test("GET /v1/moments/:kind needs the API key", async () => {
  const res = await app.request("/v1/moments/morning");
  assert.equal(res.status, 401);
});

test("GET /v1/moments/morning and /evening return a valid moment", async () => {
  for (const kind of ["morning", "evening"] as const) {
    const res = await app.request(`/v1/moments/${kind}`, { headers: auth });
    assert.equal(res.status, 200, kind);
    const body = Moment.parse(await res.json());
    assert.equal(body.kind, kind);
    assert.equal(body.timezone, "Europe/Athens");
    assert.ok(body.headline.length > 0);
  }
});

test("GET /v1/moments takes ?at= and rejects a bad kind or instant", async () => {
  const at = encodeURIComponent("2026-11-14T08:00:00+02:00");
  const ok = await app.request(`/v1/moments/morning?at=${at}`, { headers: auth });
  assert.equal(ok.status, 200);
  assert.equal(Moment.parse(await ok.json()).day, "2026-11-14");
  for (const path of ["/v1/moments/noon", "/v1/moments/morning?at=tomorrow"]) {
    const res = await app.request(path, { headers: auth });
    assert.equal(res.status, 400, path);
  }
});

test("GET /v1/moments/:kind?phrase=cached answers without the model (#378)", async () => {
  const res = await app.request("/v1/moments/morning?phrase=cached", { headers: auth });
  assert.equal(res.status, 200);
  const body = Moment.parse(await res.json());
  // No model key in the tests: the template, and nothing pending.
  assert.equal(body.phrased_by, "template");
  assert.equal(body.phrase_pending, undefined);
});
