import assert from "node:assert/strict";
import { test } from "node:test";
import { chatDot } from "./check-in";

// QA round 2 (#346): the Chat tab carried a dot on every screen all morning, from this browser's
// sample answers, while the real check in had nothing to ask.

test("chat dot: never on a guess, before the API has said", () => {
  assert.equal(chatDot(false, undefined), false);
});

test("chat dot: the live check in decides when there is one", () => {
  assert.equal(chatDot(false, false), false);
  assert.equal(chatDot(true, true), true);
});

test("chat dot: without a live check in, the sample card's answers decide", () => {
  assert.equal(chatDot(false, null), true);
  assert.equal(chatDot(true, null), false);
});
