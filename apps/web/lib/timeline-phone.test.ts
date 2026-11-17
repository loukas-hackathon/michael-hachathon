import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "@michael/shared";
import { buildTimeline } from "./timeline";

// QA walk, Sun 15 Nov: an Instagram open sent by the Michael shortcut said "Connected · last data"
// on the iPhone page, but Timeline read "No screens recorded" because it only drew Screen Time.
test("an app open from the Michael shortcut is a phone session on the timeline", () => {
  const open: Event = {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000002",
    source: "ios_shortcuts",
    type: "app_usage",
    start_at: "2026-11-15T12:16:00.000Z",
    end_at: "2026-11-15T12:17:05.000Z",
    title: "Instagram",
    data: { app: "Instagram", device: "iphone", seconds: 65 },
    external_id: null,
    created_at: "2026-11-15T12:16:00.000Z",
  } as Event;
  const day = buildTimeline("2026-11-15", [open], "2026-11-14T22:00:00.000Z", "2026-11-15T22:00:00.000Z");
  assert.equal(day.phone.length, 1);
  assert.equal(day.phone[0]?.title, "Instagram");
  assert.equal(day.totals.phoneSessions, 1);
});
