import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../app";

const post = (headers: Record<string, string>, body: unknown) =>
  app.request("/v1/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("accounts: only the web server's API key, a valid body, and no Auth means unavailable", async () => {
  const key = { authorization: "Bearer dev-key" };
  // A demo visitor rides the same key but may never create accounts.
  const visitor = { ...key, "x-michael-demo-visitor": "6f1c2f9e-6b0a-4a8e-9a3e-0b8f7d2c1a11" };
  assert.equal((await post(visitor, { email: "a@example.com", password: "long enough" })).status, 403);
  assert.equal((await post({}, { email: "a@example.com", password: "long enough" })).status, 401);
  assert.equal((await post(key, { email: "not an email", password: "long enough" })).status, 400);
  assert.equal((await post(key, { email: "a@example.com", password: "short" })).status, 400);
  // Tests run without Supabase Auth.
  assert.equal((await post(key, { email: "a@example.com", password: "long enough" })).status, 503);
});
