import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { app } from "../app";
import { runAsUser } from "../context";
import { store } from "../store";
import { locationStatus, mapNetwork, plannedVisitLines, recordSignals } from "./location";

const as = <T>(user: string, fn: () => Promise<T>) => runAsUser(user, fn, "session");
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const GYM = { key: "gym", label: "Gym", address: null, lat: 38, lng: 23.8 };
const HOME = { key: "home", label: "Home", address: null, lat: 37.98, lng: 23.72 };

test("signals become visits on the timeline, and the status says where the user is", async () => {
  const user = randomUUID();
  await as(user, async () => {
    await store.replacePlaces([GYM, HOME]);
    const r = await recordSignals({
      signals: [
        { kind: "point", at: minutesAgo(70), lat: 38, lng: 23.8 },
        { kind: "point", at: minutesAgo(5), lat: 38.0005, lng: 23.8 },
        { kind: "wifi", at: minutesAgo(4), network: "n1", name: "Ironworks Guest" },
      ],
    });
    assert.deepEqual(r, { recorded: 3, ignored: 0, at: "Gym" });
    const events = await store.listEvents({ from: minutesAgo(120), to: minutesAgo(-1), type: ["location"] });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.title, "Gym");
    assert.equal(events[0]?.source, "location");

    // A later signal extends the same event rather than adding one.
    await recordSignals({ signals: [{ kind: "wifi", at: minutesAgo(1), network: "n1" }] });
    const again = await store.listEvents({ from: minutesAgo(120), to: minutesAgo(-1), type: ["location"] });
    assert.equal(again.length, 1);

    const status = await locationStatus();
    assert.equal(status.now?.label, "Gym");
    assert.equal(status.collecting, true);
    assert.deepEqual(
      status.networks.map((n) => [n.network, n.name, n.place_key, n.suggested_place_key]),
      [["n1", "Ironworks Guest", null, "gym"]],
    );
  });
});

test("mapping a network turns its Out visits into the place, and later Wi-Fi alone finds it", async () => {
  const user = randomUUID();
  await as(user, async () => {
    await store.replacePlaces([HOME]);
    await recordSignals({ signals: [{ kind: "wifi", at: minutesAgo(30), network: "home-net" }] });
    let events = await store.listEvents({ from: minutesAgo(60), to: minutesAgo(-1), type: ["location"] });
    assert.equal(events[0]?.title, "Out");

    const status = await mapNetwork({ network: "home-net", place_key: "home" });
    assert.equal(status.networks[0]?.place_key, "home");
    events = await store.listEvents({ from: minutesAgo(60), to: minutesAgo(-1), type: ["location"] });
    assert.equal(events[0]?.title, "Home");
    assert.equal((await store.listPlaces())[0]?.wifi?.[0], "home-net");

    await recordSignals({ signals: [{ kind: "wifi", at: minutesAgo(2), network: "home-net" }] });
    assert.equal((await locationStatus()).now?.label, "Home");
  });
});

test("saving places on the Places screen keeps the Wi-Fi mapping", async () => {
  const res = await app.request("/v1/places", {
    method: "PUT",
    headers: { Authorization: "Bearer dev-key", "content-type": "application/json" },
    body: JSON.stringify({ places: [{ key: "home", lat: 37.98, lng: 23.72 }] }),
  });
  assert.equal(res.status, 200);
  await app.request("/v1/location/networks", {
    method: "PUT",
    headers: { Authorization: "Bearer dev-key", "content-type": "application/json" },
    body: JSON.stringify({ network: "demo-net", place_key: "home" }),
  });
  const again = await app.request("/v1/places", {
    method: "PUT",
    headers: { Authorization: "Bearer dev-key", "content-type": "application/json" },
    body: JSON.stringify({ places: [{ key: "home", lat: 37.98, lng: 23.72 }] }),
  });
  const body = (await again.json()) as { places: { wifi?: string[] }[] };
  assert.deepEqual(body.places[0]?.wifi, ["demo-net"]);
});

test("off the record and the source switch stop location", async () => {
  const user = randomUUID();
  await as(user, async () => {
    await store.setSourceEnabled("location", false);
    const r = await recordSignals({ signals: [{ kind: "point", at: minutesAgo(1), lat: 38, lng: 23.8 }] });
    assert.deepEqual(r, { recorded: 0, ignored: 1, at: null });
    assert.equal((await locationStatus()).last_signal_at, null);
  });
});

test("calendar events at saved places read as planned, not confirmed", async () => {
  const user = randomUUID();
  await as(user, async () => {
    await store.replacePlaces([GYM]);
    await store.insertEvents([
      {
        source: "google_calendar",
        type: "calendar_event",
        start_at: minutesAgo(120),
        end_at: minutesAgo(60),
        title: "Legs",
        data: { location: "Gym" },
        external_id: "cal-1",
      },
    ]);
    const lines = await plannedVisitLines(minutesAgo(180), minutesAgo(0), (ms) =>
      new Date(ms).toISOString().slice(11, 16),
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /at Gym \(planned in the calendar, not confirmed\)/);
  });
});

test("a device key may send location signals", async () => {
  const { deviceKeyMayCall } = await import("../auth");
  assert.equal(deviceKeyMayCall("POST", "/v1/location/signals"), true);
  assert.equal(deviceKeyMayCall("GET", "/v1/location"), false);
});
