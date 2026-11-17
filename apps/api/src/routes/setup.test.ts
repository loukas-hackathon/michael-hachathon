import assert from "node:assert/strict";
import { test } from "node:test";
import type { SetupTokenExchanged } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { macInstallCommand, macInstallScript } from "../setup/mac-script";
import { createSetupToken, exchangeSetupToken, SETUP_TTL_MS } from "../setup-tokens";
import { listPersonalTokens } from "../tokens";

// Runs against the in-memory backends (no Supabase env in tests).
const OWNER = "22222222-2222-4222-8222-222222222222";
const json = (body: unknown, token?: string): RequestInit => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

test("only a signed-in session can mint setup tokens", async () => {
  const res = await app.request("/v1/setup-tokens", json({ connection: "mac" }, "dev-key"));
  assert.equal(res.status, 403);
  const anon = await app.request("/v1/setup-tokens", json({ connection: "mac" }));
  assert.equal(anon.status, 401);
});

test("a setup token becomes one ingest only device key, once", async () => {
  const { token, expires_at } = await runAsUser(OWNER, () => createSetupToken("apple-watch"), "session");
  assert.match(token, /^ms_[A-Za-z0-9_-]{43}$/);
  assert.ok(new Date(expires_at).getTime() - Date.now() <= SETUP_TTL_MS);

  // No auth header: the setup token is the credential.
  const res = await app.request("/v1/setup-tokens/exchange", json({ token }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = (await res.json()) as SetupTokenExchanged;
  assert.equal(body.connection, "apple-watch");
  assert.match(body.secret, /^mk_/);
  assert.match(body.api_url, /^https?:\/\//);

  const keys = await runAsUser(OWNER, () => listPersonalTokens(), "session");
  assert.ok(
    keys.some((k) => k.name === "Health Auto Export"),
    "the key is named for the connection",
  );

  // The new key sends data for the owner, and cannot read.
  const ingest = await app.request(
    "/v1/events",
    json({ source: "manual", type: "note", start_at: "2026-11-14T19:00:00+02:00", title: "x" }, body.secret),
  );
  assert.equal(ingest.status, 201);

  const again = await app.request("/v1/setup-tokens/exchange", json({ token }));
  assert.equal(again.status, 401, "a setup token works once");
});

test("expired and unknown setup tokens are refused alike", async () => {
  const { token } = await runAsUser(OWNER, () => createSetupToken("mac"), "session");
  const later = new Date(Date.now() + SETUP_TTL_MS + 1000);
  await assert.rejects(exchangeSetupToken(token, later), /expired or was used/);

  for (const bad of ["ms_not_a_real_token_at_all", "mk_looks_like_a_device_key"]) {
    const res = await app.request("/v1/setup-tokens/exchange", json({ token: bad }));
    assert.equal(res.status, 401);
  }
  const malformed = await app.request("/v1/setup-tokens/exchange", json({}));
  assert.equal(malformed.status, 400);
});

test("the Mac installer is public, holds no secret and takes the token as an argument", async () => {
  const res = await app.request("/v1/setup/mac.sh");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /shellscript/);
  const script = await res.text();
  assert.match(script, /^#!\/bin\/bash/);
  assert.match(script, /\/v1\/setup-tokens\/exchange/);
  assert.doesNotMatch(script, /mk_[A-Za-z0-9]/, "no device key in the script");
  assert.doesNotMatch(script, /__API__|__REPO__|__REF__/, "every placeholder is filled");

  assert.equal(
    macInstallCommand("https://api.example.com", "ms_abc"),
    "curl -fsSL https://api.example.com/v1/setup/mac.sh | bash -s -- ms_abc",
  );
  assert.throws(() => macInstallScript({ apiBase: "https://x.com; rm -rf ~", repo: "a/b", ref: "main" }));
});

test("POST /v1/setup-tokens answers the setup page and, for the Mac, the install line", async () => {
  // A signed-in session is resolved from a Supabase token in production; tests call the route
  // inside runAsUser to stand in for it.
  const { setupTokens } = await import("./setup");
  const res = await runAsUser(
    OWNER,
    () => setupTokens.request("/setup-tokens", json({ connection: "mac" })),
    "session",
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as { token: string; setup_url: string; install_command: string | null };
  assert.ok(body.setup_url.endsWith(`/setup/mac#${body.token}`), "the token rides in the fragment");
  assert.ok(body.install_command?.endsWith(`bash -s -- ${body.token}`));

  const watch = await runAsUser(
    OWNER,
    () => setupTokens.request("/setup-tokens", json({ connection: "apple-watch" })),
    "session",
  );
  assert.equal(((await watch.json()) as { install_command: string | null }).install_command, null);
});

test("the Windows installer is public, and a Windows setup token answers the PowerShell line", async () => {
  const res = await app.request("/v1/setup/windows.ps1");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
  const script = await res.text();
  assert.match(script, /param\(\[string\]\$Token = ""\)/);
  assert.match(script, /\/v1\/setup-tokens\/exchange/);
  assert.doesNotMatch(script, /__API__|__REPO__|__REF__/);

  const { setupTokens } = await import("./setup");
  const created = await runAsUser(
    OWNER,
    () => setupTokens.request("/setup-tokens", json({ connection: "windows" })),
    "session",
  );
  assert.equal(created.status, 201);
  const body = (await created.json()) as { token: string; install_command: string | null };
  assert.match(body.install_command ?? "", /irm https?:\/\/\S+\/v1\/setup\/windows\.ps1\)\)\) ms_/);
  assert.ok(body.install_command?.endsWith(` ${body.token}`));

  // The token becomes a key named for Windows.
  const swap = await app.request("/v1/setup-tokens/exchange", json({ token: body.token }));
  assert.equal(((await swap.json()) as SetupTokenExchanged).connection, "windows");
  const keys = await runAsUser(OWNER, () => listPersonalTokens(), "session");
  assert.ok(keys.some((k) => k.name === "Windows collector"));
});
