import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../app";
import { runAsUser } from "../context";
import { createPersonalToken, revokePersonalToken } from "../tokens";

// Runs against the in-memory store (no Supabase env in tests).
const OWNER = "11111111-1111-4111-8111-111111111111";
const call = (path: string, token: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

test("the demo API key cannot manage device keys", async () => {
  const res = await call("/v1/tokens", "dev-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mac" }),
  });
  assert.equal(res.status, 403);
});

test("a device key acts for its owner, cannot mint keys, and stops working when revoked", async () => {
  const { token, secret } = await runAsUser(OWNER, () => createPersonalToken("Mac collector"), "session");
  assert.match(secret, /^mk_/);

  const ingest = await call("/v1/events", secret, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "manual",
      type: "note",
      start_at: "2026-11-14T19:00:00+02:00",
      title: "x",
    }),
  });
  assert.equal(ingest.status, 201);

  const mint = await call("/v1/tokens", secret, { method: "GET" });
  assert.equal(mint.status, 403, "a device key must not list or create keys");

  // Device keys only send data (#114): no reads, no MCP.
  assert.equal((await call("/v1/goals", secret)).status, 403, "a device key must not read data");
  assert.equal((await call("/v1/today", secret)).status, 403, "a device key must not read the day");
  const mcp = await call("/mcp", secret, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(mcp.status, 403, "a device key must not use MCP");

  await runAsUser(OWNER, () => revokePersonalToken(token.id), "session");
  const after = await call("/v1/goals", secret);
  assert.equal(after.status, 401);
});

test("unknown device keys are rejected", async () => {
  assert.equal((await call("/v1/goals", "mk_not_a_real_key")).status, 401);
});

test("the end-to-end test sign in is refused unless E2E_TEST_AUTH=on", async () => {
  assert.equal((await call("/v1/goals", `e2e_${OWNER}`)).status, 401);
});
