import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectionId } from "./connections";
import type { ConnectionState } from "./connections-status";
import { arrivedFrom, landed, rowLine, waitingLine } from "./live-connections";

test("a connection lands when it turns on, never on a first read", () => {
  const before = new Map<ConnectionId, ConnectionState>([
    ["telegram", "none"],
    ["mac", "on"],
  ]);
  assert.deepEqual(
    landed(before, [
      { id: "telegram", state: "on", fresh: "@lucas" },
      { id: "mac", state: "on", fresh: null },
      { id: "iphone", state: "on", fresh: null },
    ]),
    ["telegram"],
  );
});

test("the row says what arrived only while it is fresh", () => {
  assert.equal(rowLine("Connected", "last sync 12:41", true), "Connected · last sync 12:41");
  assert.equal(rowLine("Connected", "last sync 12:41", false), "Connected");
  assert.equal(rowLine("Connected", null, true), "Connected");
  assert.equal(waitingLine("Telegram"), "Waiting for Telegram…");
});

test("the Google return names the calendar", () => {
  assert.equal(arrivedFrom("google_calendar"), "google-calendar");
  assert.equal(arrivedFrom("nonsense"), null);
  assert.equal(arrivedFrom(undefined), null);
});
