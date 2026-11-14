import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EventInput, IngestResponse } from "@michael/shared";
import { app } from "../app";
import { HaePayload, mapHealthAutoExport, parseHaeDate } from "./health-auto-export";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/health-auto-export.json", import.meta.url), "utf8"),
);
const NOW = Date.parse("2026-11-14T10:30:00+02:00");
const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };

test("parseHaeDate reads the app's date format and ISO", () => {
  assert.equal(parseHaeDate("2024-02-06 14:30:00 -0800"), Date.parse("2024-02-06T14:30:00-08:00"));
  assert.equal(parseHaeDate("2026-11-14T07:00:00+02:00"), Date.parse("2026-11-14T05:00:00Z"));
  assert.equal(parseHaeDate("not a date"), null);
});

test("maps the sample export to sleep, workout and hourly biometrics", () => {
  const { events, skipped_metrics } = mapHealthAutoExport(HaePayload.parse(fixture), NOW);
  for (const e of events) EventInput.parse(e);
  assert.deepEqual(skipped_metrics, ["environmental_audio_exposure"]);

  const sleep = events.filter((e) => e.type === "sleep");
  assert.equal(sleep.length, 1);
  assert.equal(sleep[0]?.start_at, "2026-11-13T21:48:12.000Z");
  assert.equal(sleep[0]?.end_at, "2026-11-14T05:03:40.000Z");
  assert.equal(sleep[0]?.title, "Sleep 6h55m");
  assert.deepEqual(sleep[0]?.data, {
    duration_min: 415,
    deep_min: 65,
    rem_min: 113,
    core_min: 237,
    awake_min: 18,
    in_bed_min: 444,
    device: "Apple Watch",
  });

  const workout = events.find((e) => e.type === "workout");
  assert.equal(workout?.title, "Outdoor Run 42m, 6.1 km");
  assert.equal(workout?.external_id, "hae:workout:8E3F1C2A-6B7D-4E9A-9C21-0F5A3B7D2E11");
  assert.equal(workout?.data?.avg_hr, 148);
  assert.equal(workout?.data?.max_hr, 171);
  assert.equal(workout?.data?.active_kcal, 413);
  assert.ok(!("route" in (workout?.data ?? {})), "GPS routes are never stored");

  const bio = events.filter((e) => e.type === "biometric");
  // 10:00 to 11:00 is not over at 10:30, so heart rate and steps keep 08:00 and 09:00 only.
  assert.deepEqual(bio.map((e) => e.title).sort(), [
    "HRV 58.3 ms",
    "Heart rate 71.4 bpm, 58 to 96",
    "Heart rate 77.2 bpm, 61 to 112",
    "Resting heart rate 54 bpm",
    "Steps 1,240",
    "Steps 3,315",
  ]);
  const hr = bio.find((e) => e.title.startsWith("Heart rate 77"));
  assert.equal(hr?.external_id, "hae:heart_rate:2026-11-14T07");
  assert.deepEqual(hr?.data, {
    metric: "heart_rate",
    units: "bpm",
    samples: 1,
    min: 61,
    avg: 77.2,
    max: 112,
  });
});

test("groups unsummarised sleep segments into a night and waits for it to settle", () => {
  const seg = (startDate: string, endDate: string, value: string) => ({ startDate, endDate, value, qty: 0 });
  const payload = HaePayload.parse({
    data: {
      metrics: [
        {
          name: "sleep_analysis",
          units: "hr",
          data: [
            seg("2026-11-13 23:30:00 +0200", "2026-11-14 07:15:00 +0200", "In Bed"),
            seg("2026-11-13 23:45:00 +0200", "2026-11-14 01:45:00 +0200", "Core"),
            seg("2026-11-14 01:45:00 +0200", "2026-11-14 02:45:00 +0200", "Deep"),
            seg("2026-11-14 02:45:00 +0200", "2026-11-14 03:00:00 +0200", "Awake"),
            seg("2026-11-14 03:00:00 +0200", "2026-11-14 07:00:00 +0200", "REM"),
          ],
        },
      ],
    },
  });
  const [night] = mapHealthAutoExport(payload, NOW).events;
  assert.equal(night?.start_at, "2026-11-13T21:45:00.000Z");
  assert.equal(night?.end_at, "2026-11-14T05:00:00.000Z");
  assert.equal(night?.data?.duration_min, 420);
  assert.equal(night?.data?.deep_min, 60);
  assert.equal(night?.data?.awake_min, 15);

  // Ten minutes after waking the night may still grow: not stored yet.
  const early = mapHealthAutoExport(payload, Date.parse("2026-11-14T07:10:00+02:00"));
  assert.equal(early.events.length, 0);
});

test("skips bad samples instead of failing the export", () => {
  const payload = HaePayload.parse({
    data: {
      metrics: [
        { name: "heart_rate", units: "count/min", data: [{ date: "garbage", Avg: 70 }, { nope: true }] },
        { units: "x" },
      ],
      workouts: [{ name: "Walk" }],
      stateOfMind: [{}],
    },
  });
  assert.deepEqual(mapHealthAutoExport(payload, NOW).events, []);
});

test("POST /v1/webhooks/health-auto-export stores once and is idempotent", async () => {
  const post = (body: unknown, headers: Record<string, string> = auth) =>
    app.request("/v1/webhooks/health-auto-export", { method: "POST", headers, body: JSON.stringify(body) });

  assert.equal((await post(fixture, { "content-type": "application/json" })).status, 401);
  assert.equal((await post({ nope: 1 })).status, 400);

  const first = await post(fixture);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-michael-skipped-metrics"), "environmental_audio_exposure");
  const a = IngestResponse.parse(await first.json());
  assert.ok(a.inserted >= 1);

  const b = IngestResponse.parse(await (await post(fixture)).json());
  assert.equal(b.inserted, 0);
  assert.equal(b.duplicates, a.inserted);
});
