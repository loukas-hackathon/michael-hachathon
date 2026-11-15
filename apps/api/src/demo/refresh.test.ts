import assert from "node:assert/strict";
import test from "node:test";
import { demoRefreshGate } from "./sync";

// The first demo request after a start (#364): it waits for the first refresh of the week, but
// never longer than the cap, and the refresh goes on in the background.

test("a slow first refresh holds a demo request for the cap only", async () => {
  let finish: () => void = () => {};
  const refresh = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const start = performance.now();
  await demoRefreshGate(refresh, 40);
  const waited = performance.now() - start;
  assert.ok(waited >= 35 && waited < 500, `waited ${waited} ms`);
  finish();
  await refresh;
});

test("a quick first refresh lets the request through as soon as it is done", async () => {
  const start = performance.now();
  await demoRefreshGate(Promise.resolve(), 5_000);
  assert.ok(performance.now() - start < 100);
});
