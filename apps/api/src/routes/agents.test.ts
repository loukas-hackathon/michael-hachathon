import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { AgentClient, AgentQuery } from "@michael/shared";
import { app } from "../app";
import { athensMidnight } from "./agents";

const apiKey = { Authorization: "Bearer dev-key" };
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/** Connects an agent through the OAuth flow as the demo user; returns its access token. */
async function connect(name: string, scope: string): Promise<string> {
  const reg = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [CALLBACK] }),
  });
  const { client_id } = await reg.json();
  const verifier = randomBytes(32).toString("base64url");
  const qs = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: CALLBACK,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope,
  });
  const auth = await app.request(`/oauth/authorize?${qs}`);
  const id = new URL(auth.headers.get("location") ?? "").searchParams.get("request");
  const decided = await app.request(`/v1/connect/requests/${id}`, {
    method: "POST",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ allow: true }),
  });
  const code = new URL((await decided.json()).redirect_to).searchParams.get("code") ?? "";
  const token = await app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id,
    }).toString(),
  });
  return (await token.json()).access_token;
}

async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

const listAgents = async () =>
  AgentClient.array().parse((await (await app.request("/v1/agents", { headers: apiKey })).json()).agents);
const listQueries = async () =>
  AgentQuery.array().parse(
    (await (await app.request("/v1/agents/queries", { headers: apiKey })).json()).queries,
  );

test("the consent tap creates an approved agent; scopes gate tools; every call is logged", async () => {
  const token = await connect("Cursor", "timeline");
  const agent = (await listAgents()).find((a) => a.name === "Cursor");
  assert.ok(agent);
  assert.equal(agent.status, "approved");
  assert.deepEqual(agent.scopes, ["timeline"]);

  const read = await callTool(token, "get_timeline", {});
  assert.equal(read.status, 200);
  assert.notEqual(read.body.result.isError, true);

  const write = await callTool(token, "add_event", {
    source: "agent",
    type: "note",
    start_at: new Date().toISOString(),
    title: "Ran 5 km",
  });
  assert.equal(write.body.result.isError, true);
  assert.match(write.body.result.content[0].text, /Not allowed/);

  const mine = (await listQueries()).filter((q) => q.agent_id === agent.id);
  assert.deepEqual(
    mine.map((q) => [q.tool, q.allowed]),
    [
      ["add_event", false],
      ["get_timeline", true],
    ],
  );
  assert.equal(mine[0]?.summary, 'Added "Ran 5 km" to your day');
  // Not shared: nothing changed. A read changes nothing either way.
  assert.deepEqual(
    mine.map((q) => q.changed),
    [false, null],
  );
  assert.ok((await listAgents()).find((a) => a.id === agent.id)?.last_seen_at);

  // The user switches writing on: the same token may now add to the day.
  const patched = await app.request(`/v1/agents/${agent.id}`, {
    method: "PATCH",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ scopes: ["timeline", "write_events"] }),
  });
  assert.equal(patched.status, 200);
  const again = await callTool(token, "add_event", {
    source: "agent",
    type: "note",
    start_at: new Date().toISOString(),
    title: "Ran 5 km",
  });
  assert.notEqual(again.body.result.isError, true);

  // Revoke: the token stops working at once.
  const revoked = await app.request(`/v1/agents/${agent.id}`, {
    method: "PATCH",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ status: "revoked" }),
  });
  assert.equal(AgentClient.parse(await revoked.json()).status, "revoked");
  assert.equal((await callTool(token, "get_goals", {})).status, 401);
});

test("a block an agent books carries its recommendation and can be undone from the log", async () => {
  const token = await connect("Gemini", "timeline write_events");
  const start = new Date(Date.now() + 2 * 86_400_000);
  start.setUTCHours(13, 0, 0, 0);
  const booked = await callTool(token, "create_focus_block", {
    start: start.toISOString(),
    end: new Date(start.getTime() + 3_600_000).toISOString(),
    title: "Focus: pitch deck",
  });
  assert.notEqual(booked.body.result.isError, true, booked.body.result.content?.[0]?.text);
  const recId = booked.body.result.structuredContent.recommendation.id;

  const agent = (await listAgents()).find((a) => a.name === "Gemini");
  const line = (await listQueries()).find((q) => q.agent_id === agent?.id && q.tool === "create_focus_block");
  assert.equal(line?.recommendation_id, recId);
  assert.ok(line?.undo_until && Date.parse(line.undo_until) > Date.now());
  assert.equal(line?.changed, true);

  // The same call for a time that has passed is refused: the log says so, and it is no change.
  const late = await callTool(token, "create_focus_block", {
    start: new Date(Date.now() - 3_600_000).toISOString(),
    end: new Date(Date.now() + 3_600_000).toISOString(),
    title: "Past",
  });
  assert.equal(late.body.result.isError, true);
  const tried = (await listQueries()).find((q) => q.agent_id === agent?.id && q.summary.includes('"Past"'));
  assert.match(
    tried?.summary ?? "",
    /^Tried to book "Past" for \w{3} \d\d:\d\d\. Refused: already started\.$/,
  );
  assert.deepEqual(
    [tried?.allowed, tried?.changed, tried?.recommendation_id, tried?.undo_until],
    [true, false, null, null],
  );

  const undo = await app.request(`/v1/recommendations/${recId}/undo`, { method: "POST", headers: apiKey });
  assert.equal(undo.status, 200);
  const after = (await listQueries()).find((q) => q.id === line?.id);
  assert.equal(after?.undo_until, null);
});

test("log_done and confirm_block need write_events; a logged entry can be undone from the log", async () => {
  const created = await app.request("/v1/goals", {
    method: "POST",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ category: "personal", title: "Evening bath", weekly_budget_minutes: 60 }),
  });
  const goal = (await created.json()) as { id: string };
  const reader = await connect("Perplexity", "timeline goals");
  const refused = await callTool(reader, "log_done", { goal_id: goal.id, minutes: 40 });
  assert.equal(refused.body.result.isError, true);
  assert.match(refused.body.result.content[0].text, /Not allowed/);
  const settle = await callTool(reader, "confirm_block", { event_id: goal.id, did: true });
  assert.match(settle.body.result.content[0].text, /Not allowed/);

  const writer = await connect("Mistral", "timeline write_events");
  const logged = await callTool(writer, "log_done", { goal_id: goal.id, minutes: 40 });
  assert.notEqual(logged.body.result.isError, true, logged.body.result.content?.[0]?.text);
  assert.match(logged.body.result.content[0].text, /^Logged\. Evening bath \d+ of 60 min this week\./);
  const recId = logged.body.result.structuredContent.recommendation.id;
  const agent = (await listAgents()).find((a) => a.name === "Mistral");
  const line = (await listQueries()).find((q) => q.agent_id === agent?.id && q.tool === "log_done");
  assert.equal(line?.recommendation_id, recId);
  assert.equal(line?.summary, "Logged 40 min of a goal");
  const undo = await app.request(`/v1/recommendations/${recId}/undo`, { method: "POST", headers: apiKey });
  assert.equal(undo.status, 200);
});

test("reconnecting the same agent updates one record", async () => {
  await connect("Claude", "timeline");
  await connect("Claude", "timeline goals");
  const claudes = (await listAgents()).filter((a) => a.name === "Claude");
  assert.equal(claudes.length, 1);
  assert.deepEqual(claudes[0]?.scopes, ["timeline", "goals"]);
});

test("PATCH /v1/agents/:id validates and 404s", async () => {
  const missing = await app.request("/v1/agents/00000000-0000-4000-8000-000000000000", {
    method: "PATCH",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ status: "approved" }),
  });
  assert.equal(missing.status, 404);
  const bad = await app.request("/v1/agents/00000000-0000-4000-8000-000000000000", {
    method: "PATCH",
    headers: { ...apiKey, "content-type": "application/json" },
    body: JSON.stringify({ scopes: ["everything"] }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await app.request("/v1/agents/queries?from=yesterday", { headers: apiKey })).status, 400);
});

test("the API key on /mcp is not an agent and is not logged", async () => {
  const before = (await listQueries()).length;
  assert.equal((await callTool("dev-key", "get_goals", {})).status, 200);
  assert.equal((await listQueries()).length, before);
});

test("athensMidnight is local midnight", () => {
  assert.equal(athensMidnight(new Date("2026-11-14T12:00:00Z")), "2026-11-13T22:00:00.000Z");
  assert.equal(athensMidnight(new Date("2026-07-01T12:00:00Z")), "2026-06-30T21:00:00.000Z");
});
