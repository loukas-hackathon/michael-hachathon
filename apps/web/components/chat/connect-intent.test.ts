import assert from "node:assert/strict";
import { test } from "node:test";
import { CONNECTOR_STATUS } from "@michael/shared";
import { CONNECT_TARGET, connectIntent } from "./connect-intent";

test("connect intent: the person's own words pick the connection", () => {
  assert.equal(connectIntent("connect my calendar"), "google-calendar");
  assert.equal(connectIntent("Can you link Google Calendar?"), "google-calendar");
  assert.equal(connectIntent("set up telegram please"), "telegram");
  assert.equal(connectIntent("How do I connect Claude?"), "claude");
  assert.equal(connectIntent("turn on notifications"), "nudges");
});

test("connect intent: questions about the day get no button", () => {
  assert.equal(connectIntent("what is on my calendar today?"), null);
  assert.equal(connectIntent("how did I sleep"), null);
  assert.equal(connectIntent("add a gym block at 18:00"), null);
  assert.equal(connectIntent("add focus time to my calendar"), null);
  assert.equal(connectIntent("move my calendar block, and connect me to the gym plan"), null);
});

test("connect intent: Coming soon connections never get a button", () => {
  for (const [id, status] of Object.entries(CONNECTOR_STATUS)) {
    if (status === "live") continue;
    const words = { "apple-watch": "watch", mac: "mac", iphone: "iphone", travel: "location" }[id];
    if (words) assert.equal(connectIntent(`connect my ${words}`), null, id);
  }
});

test("connect intent: the calendar button goes straight to Google and back to chat", () => {
  assert.equal(CONNECT_TARGET["google-calendar"].href, "/integrations/google/connect?return_to=%2Fchat");
});
