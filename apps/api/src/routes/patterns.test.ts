import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type EventInput, PatternReport, PhoneCadenceReport } from "@michael/shared";
import type { z } from "zod";
import { app } from "../app";
import { runAsUser } from "../context";
import { store } from "../store";
import { eventsByDay, patternReportFor, phoneCadenceFor } from "./patterns";

const auth = { Authorization: "Bearer dev-key" };

test("eventsByDay reads the same events as one read, each once, in the store's order (#364)", () =>
  runAsUser(randomUUID(), async () => {
    const at = (h: number) => new Date(Date.parse("2026-11-10T00:00:00Z") + h * 3600_000).toISOString();
    await store.insertEvents(
      [1, 23, 25, 47, 70, 95, 100].map((h, i) => ({
        source: "macos_usage" as const,
        type: "app_usage" as const,
        start_at: at(h),
        end_at: at(h + 2),
        title: `App ${i}`,
        data: {},
      })),
    );
    const whole = await store.listEvents({ from: at(0), to: at(96) });
    const days = await eventsByDay(Date.parse(at(0)), Date.parse(at(96)));
    assert.ok(whole.length >= 6);
    assert.deepEqual(
      days.map((e) => e.id),
      whole.map((e) => e.id),
    );
    assert.equal(new Set(days.map((e) => e.id)).size, days.length);
  }));

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

test("GET /v1/patterns/phone-cadence answers exactly the full report's phone cadence (#298)", () =>
  runAsUser(randomUUID(), async () => {
    // Six days of the iPhone picked up every 25 minutes from 08:00 to 19:00 UTC, the Mac busy
    // alongside, and a night each, which is not a waking gap.
    const now = Date.now();
    const dayStart = (d: number) => Math.floor(now / 86_400_000) * 86_400_000 - d * 86_400_000;
    const rows: z.output<typeof EventInput>[] = [];
    for (let d = 1; d <= 6; d++) {
      for (let m = 8 * 60; m < 19 * 60; m += 25) {
        const start = dayStart(d) + m * 60_000;
        rows.push({
          source: "iphone_usage",
          type: "app_usage",
          start_at: new Date(start).toISOString(),
          end_at: new Date(start + 90_000).toISOString(),
          title: m % 50 ? "Instagram" : "Mail",
          data: {
            bundle_id: m % 50 ? "com.burbn.instagram" : "com.apple.mobilemail",
            opened_from: m % 75 ? "notification" : "home_screen",
          },
        });
        rows.push({
          source: "macos_usage",
          type: "app_usage",
          start_at: new Date(start + 120_000).toISOString(),
          end_at: new Date(start + 20 * 60_000).toISOString(),
          title: "Code",
          data: { bundle_id: "com.microsoft.VSCode" },
        });
      }
      rows.push({
        source: "health_auto_export",
        type: "sleep",
        start_at: new Date(dayStart(d) - 2 * 3600_000).toISOString(),
        end_at: new Date(dayStart(d) + 6 * 3600_000).toISOString(),
        title: "Sleep",
        data: {},
      });
    }
    const { inserted } = await store.insertEvents(rows);
    assert.equal(inserted.length, rows.length);

    const narrow = PhoneCadenceReport.parse(await phoneCadenceFor());
    const full = await patternReportFor({});
    assert.equal(narrow.phone_cadence.status, "ok");
    assert.deepEqual(narrow.phone_cadence, full.phone_cadence);
    assert.equal(narrow.timezone, "Europe/Athens");
  }));

test("GET /v1/patterns/phone-cadence answers for the caller, not enough data included", async () => {
  const res = await app.request("/v1/patterns/phone-cadence", { headers: auth });
  assert.equal(res.status, 200);
  const body = PhoneCadenceReport.parse(await res.json());
  assert.ok(["ok", "not_enough_data"].includes(body.phone_cadence.status));
  assert.equal(Date.parse(body.to) - Date.parse(body.from), 7 * 86_400_000);
});
