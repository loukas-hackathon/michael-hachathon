import assert from "node:assert/strict";
import { test } from "node:test";
import { PatternReport } from "@michael/shared";
import { app } from "../app";

const auth = { Authorization: "Bearer dev-key" };

test("GET /v1/patterns needs the API key", async () => {
  const res = await app.request("/v1/patterns");
  assert.equal(res.status, 401);
});

test("GET /v1/patterns returns a valid report for the last 7 days by default", async () => {
  const before = Date.now();
  const res = await app.request("/v1/patterns", { headers: auth });
  assert.equal(res.status, 200);
  const body = PatternReport.parse(await res.json());
  assert.equal(body.timezone, "Europe/Athens");
  const span = Date.parse(body.to) - Date.parse(body.from);
  assert.equal(span, 7 * 24 * 3600_000);
  assert.ok(Date.parse(body.to) >= before - 1000);
});

test("GET /v1/patterns takes a range and rejects a bad one", async () => {
  const ok = await app.request(
    `/v1/patterns?from=${encodeURIComponent("2026-11-14T00:00:00+02:00")}&to=${encodeURIComponent("2026-11-15T00:00:00+02:00")}`,
    { headers: auth },
  );
  assert.equal(ok.status, 200);
  const body = PatternReport.parse(await ok.json());
  assert.deepEqual(body.days, [{ day: "2026-11-14", complete: true }]);

  for (const query of [
    "from=yesterday",
    "to=2026-11-14",
    `from=${encodeURIComponent("2026-11-15T00:00:00+02:00")}&to=${encodeURIComponent("2026-11-14T00:00:00+02:00")}`,
    `from=${encodeURIComponent("2026-01-01T00:00:00+02:00")}&to=${encodeURIComponent("2026-11-14T00:00:00+02:00")}`,
  ]) {
    const res = await app.request(`/v1/patterns?${query}`, { headers: auth });
    assert.equal(res.status, 400, query);
    const error = (await res.json()) as { error: { code: string } };
    assert.equal(error.error.code, "bad_request", query);
  }
});
