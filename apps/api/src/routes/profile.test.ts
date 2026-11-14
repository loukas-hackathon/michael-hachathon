import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PROFILE, Profile } from "@michael/shared";
import { app } from "../app";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });

// One test, in order: the store is shared per user and these steps build on each other.
test("profile: defaults, partial update, validation", async () => {
  let res = await call("GET", "/v1/profile");
  assert.equal(res.status, 200);
  let p = Profile.parse(await res.json());
  assert.deepEqual(p, DEFAULT_PROFILE);

  res = await call("PUT", "/v1/profile", {
    quiet_hours: { start: "23:00", end: "06:30" },
    weak_spots: ["phone_in_bed", "late_nights"],
    onboarded_at: "2026-11-14T20:00:00Z",
  });
  assert.equal(res.status, 200);
  p = Profile.parse(await res.json());
  assert.deepEqual(p.quiet_hours, { start: "23:00", end: "06:30" });
  assert.deepEqual(p.weak_spots, ["phone_in_bed", "late_nights"]);
  assert.deepEqual(p.work_days, DEFAULT_PROFILE.work_days);
  assert.ok(p.updated_at);

  // Only the fields sent change.
  p = Profile.parse(await (await call("PUT", "/v1/profile", { gym_days: ["tue", "sat"] })).json());
  assert.deepEqual(p.gym_days, ["tue", "sat"]);
  assert.deepEqual(p.weak_spots, ["phone_in_bed", "late_nights"]);
  assert.equal(p.onboarded_at, "2026-11-14T20:00:00Z");

  res = await call("PUT", "/v1/profile", { quiet_hours: { start: "25:00", end: "07:00" } });
  assert.equal(res.status, 400);
  res = await call("PUT", "/v1/profile", { weak_spots: ["eating_crisps"] });
  assert.equal(res.status, 400);
});
