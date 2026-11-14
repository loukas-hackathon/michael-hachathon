import assert from "node:assert/strict";
import { test } from "node:test";
import { PlacesResponse, PrivacyState, TravelPlanResult } from "@michael/shared";
import { app } from "../app";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });

// Tests run without GOOGLE_MAPS_API_KEY: places are kept, nothing calls Google.
test("places: save, read back, opt in to maps, and plan degrades without a key", async () => {
  let res = await call("GET", "/v1/places");
  assert.equal(res.status, 200);
  let body = PlacesResponse.parse(await res.json());
  assert.equal(body.maps_available, false);

  res = await call("PUT", "/v1/places", { places: [{ key: "Home!" }] });
  assert.equal(res.status, 400);

  res = await call("PUT", "/v1/places", {
    places: [
      { key: "home", lat: 38, lng: 23.8 },
      { key: "gym", label: "Ironworks", address: "Ermou 10, Athens" },
    ],
  });
  assert.equal(res.status, 200);
  body = PlacesResponse.parse(await res.json());
  assert.deepEqual(
    body.places.map((p) => [p.key, p.label, p.lat]),
    [
      ["gym", "Ironworks", null],
      ["home", "Home", 38],
    ].sort(),
  );
  assert.equal(body.travel_enabled, true);
  const privacy = PrivacyState.parse(await (await call("GET", "/v1/privacy")).json());
  assert.equal(privacy.sources.find((s) => s.source === "maps")?.enabled, true);

  res = await call("POST", "/v1/travel/plan");
  assert.equal(res.status, 200);
  const plan = TravelPlanResult.parse(await res.json());
  assert.equal(plan.status, "maps_unavailable");
  assert.equal(plan.travel.length, 0);
});
