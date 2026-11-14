import assert from "node:assert/strict";
import { test } from "node:test";
import { countedFetch, runTimed, serverTimingEntries, untimed } from "./timing";

test("countedFetch counts round trips for the current request only", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response("[]")) as typeof fetch;
  try {
    const { t, result } = runTimed(async () => {
      await Promise.all([countedFetch("https://db.test/a"), countedFetch("https://db.test/b")]);
      // Background work (the demo refresh) is not billed to the request.
      await untimed(() => countedFetch("https://db.test/c"));
    });
    await result;
    assert.equal(t.dbCount, 2);
    assert.match(serverTimingEntries(t)[0] as string, /^db;desc="2 round trips";dur=\d+\.\d$/);
    // Outside any request nothing is counted and nothing throws.
    await countedFetch("https://db.test/d");
  } finally {
    globalThis.fetch = real;
  }
});

test("every response carries db and auth Server-Timing entries", async () => {
  const { app } = await import("./app");
  const res = await app.request("/health");
  const header = res.headers.get("server-timing") ?? "";
  assert.match(header, /db;desc="0 round trips"/);
  assert.match(header, /auth;dur=/);
});
