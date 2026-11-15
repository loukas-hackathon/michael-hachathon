import assert from "node:assert/strict";
import { test } from "node:test";
import type { Integration } from "@michael/shared";
import { calendarCardFor } from "./calendar-card-state";

const cal = (over: Partial<Integration>): Integration => ({
  provider: "google_calendar",
  status: "disconnected",
  account: null,
  connected_at: null,
  last_sync_at: null,
  error: null,
  ...over,
});

test("calendar card: quiet when the calendar is fine or could not be read", () => {
  assert.equal(calendarCardFor(null, { emptyDay: false }), null);
  assert.equal(calendarCardFor(cal({ status: "connected" }), { emptyDay: false }), null);
});

test("calendar card: a broken calendar always shows, with Reconnect", () => {
  assert.equal(calendarCardFor(cal({ status: "error" }), { emptyDay: true })?.cta, "Reconnect");
  assert.equal(
    calendarCardFor(cal({ status: "connected", error: "invalid_grant" }), { emptyDay: false })?.cta,
    "Reconnect",
  );
});

test("calendar card: not connected shows only when Get started is not already asking", () => {
  assert.equal(calendarCardFor(cal({}), { emptyDay: true }), null);
  assert.deepEqual(calendarCardFor(cal({}), { emptyDay: false }), {
    line: "Connect your calendar so I can plan your day.",
    cta: "Connect",
  });
});
