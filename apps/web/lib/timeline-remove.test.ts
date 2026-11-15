import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "@michael/shared";
import { plansOf } from "./timeline";

// #457: Remove is offered on the user's own blocks (Michael's, their own solo and Google events),
// never on an event with other people or one that has started.

const HOUR = 3600_000;
const now = Date.parse("2026-11-15T10:00:00Z");
const dayStart = Date.parse("2026-11-14T22:00:00Z");
const dayEnd = dayStart + 24 * HOUR;

const ev = (id: string, startH: number, over: Partial<Event> = {}): Event =>
  ({
    id,
    source: "google_calendar",
    type: "calendar_event",
    start_at: new Date(now + startH * HOUR).toISOString(),
    end_at: new Date(now + (startH + 1) * HOUR).toISOString(),
    title: id,
    data: {},
    external_id: id,
    created_at: new Date(now).toISOString(),
    ...over,
  }) as Event;

test("Remove is offered on the user's own blocks, never with other people or once started", () => {
  const plans = plansOf(
    [
      ev("google-solo", 2),
      ev("manual", 3, { source: "manual" }),
      ev("michael", 4, { source: "agent", data: { michael: true } }),
      ev("board", 5, { data: { with_others: true, attendees: 4 } }),
      ev("started", -0.5),
    ],
    dayStart,
    dayEnd,
    now,
  );
  const removable = Object.fromEntries(plans.map((p) => [p.id, p.removable]));
  assert.deepEqual(removable, {
    "google-solo": true,
    manual: true,
    michael: true,
    board: false,
    started: false,
  });
});
