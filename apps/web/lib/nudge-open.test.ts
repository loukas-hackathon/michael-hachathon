import assert from "node:assert/strict";
import { test } from "node:test";
import { nudgeAction, nudgeFromHash } from "./nudge-open";

const hashOf = (value: unknown) => `#nudge=${encodeURIComponent(JSON.stringify(value))}`;

test("reads the nudge the worker put in the fragment", () => {
  const text = "Wrap up, your block starts at 14:00.";
  assert.deepEqual(nudgeFromHash(hashOf({ text, kind: "block_soon", at: 5 })), {
    text,
    kind: "block_soon",
    at: 5,
  });
  assert.deepEqual(nudgeAction("block_soon"), { href: "/timeline", label: "See the block" });
});

test("ignores anything else in the fragment", () => {
  assert.equal(nudgeFromHash(""), null);
  assert.equal(nudgeFromHash("#connections"), null);
  assert.equal(nudgeFromHash("#nudge=%7Bbad"), null);
  assert.equal(nudgeFromHash(hashOf({ text: "" })), null);
  assert.equal(nudgeAction("morning"), null);
});
