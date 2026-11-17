import assert from "node:assert/strict";
import { test } from "node:test";
import { withTimeout } from "./focus-events";

test("End early never waits forever: no answer in time reads as null", async () => {
  assert.equal(await withTimeout(new Promise(() => {}), 20), null);
  assert.equal(await withTimeout(Promise.resolve("done"), 1_000), "done");
  await assert.rejects(withTimeout(Promise.reject(new Error("lost")), 1_000), /lost/);
});
