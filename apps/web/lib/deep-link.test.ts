import assert from "node:assert/strict";
import { test } from "node:test";
import { deepLinkSelector } from "./deep-link";

test("deep link: a card on Today, a block on the Timeline, nothing else", () => {
  assert.equal(
    deepLinkSelector("?card=2b0c9a8e-1f2a-4c3d-9e8f-0a1b2c3d4e5f"),
    '[data-rec-id="2b0c9a8e-1f2a-4c3d-9e8f-0a1b2c3d4e5f"]',
  );
  assert.equal(deepLinkSelector("?day=2026-11-15&block=abc_123"), '[data-block-id="abc_123"]');
  assert.equal(deepLinkSelector("?day=2026-11-15"), null);
  assert.equal(deepLinkSelector(""), null);
});

test("deep link: anything that could break out of the selector is ignored", () => {
  assert.equal(deepLinkSelector('?block="],body,[x="'), null);
  assert.equal(deepLinkSelector("?card=a%20b"), null);
});
