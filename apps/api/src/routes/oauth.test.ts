import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { ConnectDecisionResponse, ConnectRequest } from "@michael/shared";
import { agentsStore } from "../agents-store";
import { app } from "../app";
import { dbError } from "../http";

// The whole claude.ai connector flow against the in-memory store: 401 with discovery pointer,
// metadata, registration, authorise, consent, token, MCP call, refresh.
const BASE = "http://localhost";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const apiKey = { Authorization: "Bearer dev-key" };

const mcpCall = (token: string) =>
  app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

const form = (o: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(o).toString(),
});

test("unauthenticated /mcp answers 401 with the resource metadata pointer", async () => {
  const res = await app.request("/mcp", { method: "POST" });
  assert.equal(res.status, 401);
  assert.match(
    res.headers.get("www-authenticate") ?? "",
    /^Bearer resource_metadata="http:\/\/localhost\/\.well-known\/oauth-protected-resource\/mcp"/,
  );
});

test("discovery documents point at each other", async () => {
  const pr = await (await app.request("/.well-known/oauth-protected-resource/mcp")).json();
  assert.equal(pr.resource, `${BASE}/mcp`);
  assert.deepEqual(pr.authorization_servers, [BASE]);
  const as = await (await app.request("/.well-known/oauth-authorization-server")).json();
  assert.equal(as.issuer, BASE);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.equal(as.registration_endpoint, `${BASE}/oauth/register`);
});

test("registration rejects a plain http redirect", async () => {
  const res = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_redirect_uri");
});

test("register, authorise, allow; a wrong PKCE verifier burns the code", async () => {
  const reg = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK] }),
  });
  assert.equal(reg.status, 201);
  const { client_id } = await reg.json();

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const qs = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    scope: "timeline goals",
    resource: `${BASE}/mcp`,
  });
  const auth = await app.request(`/oauth/authorize?${qs}`);
  assert.equal(auth.status, 302);
  const consent = new URL(auth.headers.get("location") ?? "");
  assert.equal(consent.pathname, "/connect");
  const requestId = consent.searchParams.get("request") ?? "";

  // The web consent page reads the request as the signed in user (API key = demo user here).
  const info = ConnectRequest.parse(
    await (await app.request(`/v1/connect/requests/${requestId}`, { headers: apiKey })).json(),
  );
  assert.equal(info.client_name, "Claude");
  assert.equal(info.redirect_host, "claude.ai");
  assert.deepEqual(info.scopes, ["timeline", "goals"]);
  assert.equal((await app.request(`/v1/connect/requests/${requestId}`)).status, 401);

  const decided = await app.request(`/v1/connect/requests/${requestId}`, {
    method: "POST",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ allow: true }),
  });
  assert.equal(decided.status, 200);
  const back = new URL(ConnectDecisionResponse.parse(await decided.json()).redirect_to);
  assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
  assert.equal(back.searchParams.get("state"), "xyz");
  const code = back.searchParams.get("code") ?? "";

  const bad = await app.request(
    "/oauth/token",
    form({
      grant_type: "authorization_code",
      code,
      code_verifier: "wrong",
      client_id,
      redirect_uri: CALLBACK,
    }),
  );
  assert.equal(bad.status, 400);
  // A failed attempt still burns the code (single use).
  const tokenRes = await app.request(
    "/oauth/token",
    form({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id,
      redirect_uri: CALLBACK,
    }),
  );
  assert.equal(tokenRes.status, 400);
});

test("allowed request gives a token that works on /mcp and refreshes", async () => {
  const reg = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["http://localhost/callback"] }),
  });
  const { client_id } = await reg.json();
  const verifier = randomBytes(32).toString("base64url");
  const redirect = "http://localhost:4711/callback"; // loopback: any port
  const qs = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirect,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  const auth = await app.request(`/oauth/authorize?${qs}`);
  const requestId = new URL(auth.headers.get("location") ?? "").searchParams.get("request");
  const decided = await app.request(`/v1/connect/requests/${requestId}`, {
    method: "POST",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ allow: true }),
  });
  const code = new URL((await decided.json()).redirect_to).searchParams.get("code") ?? "";

  const tokenRes = await app.request(
    "/oauth/token",
    form({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id,
      redirect_uri: redirect,
    }),
  );
  assert.equal(tokenRes.status, 200);
  const tokens = await tokenRes.json();
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.scope.split(" ").length, 5); // no scope asked: all of them

  const ok = await mcpCall(tokens.access_token);
  assert.equal(ok.status, 200);
  assert.ok(JSON.stringify(await ok.json()).includes("get_timeline"));

  const refreshed = await app.request(
    "/oauth/token",
    form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id }),
  );
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json();
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  assert.equal((await mcpCall(next.access_token)).status, 200);
  // The old refresh token is gone after rotation.
  const reused = await app.request(
    "/oauth/token",
    form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
  );
  assert.equal((await reused.json()).error, "invalid_grant");

  const denied = await mcpCall("mcp_at_not-a-token");
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
});

test("refusing sends the client access_denied", async () => {
  const reg = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [CALLBACK] }),
  });
  const { client_id } = await reg.json();
  const qs = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: CALLBACK,
    code_challenge: "abc",
    code_challenge_method: "S256",
    state: "s1",
  });
  const auth = await app.request(`/oauth/authorize?${qs}`);
  const requestId = new URL(auth.headers.get("location") ?? "").searchParams.get("request");
  const decided = await app.request(`/v1/connect/requests/${requestId}`, {
    method: "POST",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ allow: false }),
  });
  const back = new URL((await decided.json()).redirect_to);
  assert.equal(back.searchParams.get("error"), "access_denied");
  assert.equal(back.searchParams.get("state"), "s1");
  assert.equal((await app.request(`/v1/connect/requests/${requestId}`, { headers: apiKey })).status, 404);
});

test("the API key still works on /mcp, also as ?key=", async () => {
  assert.equal((await mcpCall("dev-key")).status, 200);
  const res = await app.request("/mcp?key=dev-key", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 200);
});

// Production, 14 Nov 22:52: a browser still held the session of an account deleted minutes before.
// Its token verified locally, the consent page showed, and Allow hit the auth.users foreign key:
// a 502 and a raw error page, three times. Now it is a 401, which the web app turns into a fresh
// sign in that comes back to the same consent page; the request stays answerable.
test("consent for an account that no longer exists is a 401 and leaves the request pending", async () => {
  const reg = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK] }),
  });
  const { client_id } = await reg.json();
  const qs = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: CALLBACK,
    code_challenge: createHash("sha256").update("v".repeat(43)).digest("base64url"),
    code_challenge_method: "S256",
  });
  const auth = await app.request(`/oauth/authorize?${qs}`);
  const requestId = new URL(auth.headers.get("location") ?? "").searchParams.get("request") ?? "";

  // Long enough for a first Google sign in on a phone, calendar consent screen included.
  const info = ConnectRequest.parse(
    await (await app.request(`/v1/connect/requests/${requestId}`, { headers: apiKey })).json(),
  );
  const minutesLeft = (Date.parse(info.expires_at) - Date.now()) / 60_000;
  assert.ok(minutesLeft > 29 && minutesLeft <= 30, `request lives 30 minutes, got ${minutesLeft}`);

  const original = agentsStore.approveAgent.bind(agentsStore);
  agentsStore.approveAgent = async () => {
    throw dbError({
      code: "23503",
      message:
        'insert or update on table "agent_clients" violates foreign key constraint "agent_clients_user_id_fkey"',
    });
  };
  try {
    const dead = await app.request(`/v1/connect/requests/${requestId}`, {
      method: "POST",
      headers: { ...apiKey, "content-type": "application/json" },
      body: JSON.stringify({ allow: true }),
    });
    assert.equal(dead.status, 401);
  } finally {
    agentsStore.approveAgent = original;
  }

  // Signed in again, the same request still answers.
  const decided = await app.request(`/v1/connect/requests/${requestId}`, {
    method: "POST",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ allow: true }),
  });
  assert.equal(decided.status, 200);
});

test("dbError: only a missing user is a 401; every other database error stays a 502", () => {
  assert.equal(
    dbError({ code: "23503", message: 'violates foreign key constraint "oauth_grants_user_id_fkey"' }).code,
    "unauthorized",
  );
  assert.equal(
    dbError({ code: "23503", message: 'violates foreign key constraint "oauth_grants_client_id_fkey"' }).code,
    "upstream_error",
  );
  assert.equal(dbError({ code: "23505", message: "duplicate key value" }).code, "upstream_error");
  assert.equal(dbError({ message: "fetch failed" }).code, "upstream_error");
});
