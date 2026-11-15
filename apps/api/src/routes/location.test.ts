import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { runAsUser } from "../context";
import { store } from "../store";
import { locationStatus, plannedVisitLines, recordSignals } from "./location";

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
      ],
    });
    assert.deepEqual(r, { recorded: 2, ignored: 0, at: "Gym" });
    const events = await store.listEvents({ from: minutesAgo(120), to: minutesAgo(-1), type: ["location"] });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.title, "Gym");
    assert.equal(events[0]?.source, "location");

    // A later signal extends the same event rather than adding one.
    await recordSignals({ signals: [{ kind: "point", at: minutesAgo(1), lat: 38, lng: 23.8 }] });
    const again = await store.listEvents({ from: minutesAgo(120), to: minutesAgo(-1), type: ["location"] });
    assert.equal(again.length, 1);

    const status = await locationStatus();
    assert.equal(status.now?.label, "Gym");
    assert.equal(status.collecting, true);
  });
});

test("a point near no saved place is Out, rounded to about a kilometre", async () => {
  const user = randomUUID();
  await as(user, async () => {
    await store.replacePlaces([HOME]);
    await recordSignals({ signals: [{ kind: "point", at: minutesAgo(10), lat: 37.91234, lng: 23.65678 }] });
    const [e] = await store.listEvents({ from: minutesAgo(60), to: minutesAgo(-1), type: ["location"] });
    assert.equal(e?.title, "Out");
    assert.equal(e?.data.lat, 37.91);
    assert.equal(e?.data.lng, 23.66);
  });
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
