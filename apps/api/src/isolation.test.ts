import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hono } from "hono";
import { app, v1Routes } from "./app";
import { type AuthMethod, runAsUser } from "./context";
import { seedDemoWeek } from "./demo/sync";
import { DEMO_VISITOR_HEADER, DEMO_VISITOR_MESSAGE, demoVisitorMay } from "./demo/visitor";
import { env } from "./env";
import { errorResponse, HttpError } from "./http";
import { createMcpServer } from "./mcp";
import { store } from "./store";

// Each account sees only its own data (#197). User A writes through every write route; user B,
// the demo account and demo visitors must not read or change any of it, through any GET, PATCH or
// DELETE route or any MCP tool. Runs on the in-memory store, which scopes exactly like the
// database (every query by the current user).

const A = randomUUID();
const B = randomUUID();
const DEMO = env.DEMO_USER_ID;
const MARK = `secret-of-a-${A.slice(0, 8)}`;

// The /v1 routes behind a signed in session for the user named in a test header (Supabase is not
// configured in tests, so real session tokens cannot be verified here).
const sessions = new Hono()
  .use(async (c, next) => runAsUser(c.req.header("x-test-user") as string, next, "session" as AuthMethod))
  .route("/v1", v1Routes)
  .onError((err, c) =>
    err instanceof HttpError
      ? errorResponse(c, err.code, err.message)
      : errorResponse(c, "internal", String(err)),
  );

type Who = { user: string } | { demo: true } | { visitor: string };

function request(who: Who, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  if ("user" in who) {
    headers["x-test-user"] = who.user;
    return sessions.request(path, init);
  }
  headers.authorization = `Bearer ${env.API_KEY}`;
  if ("visitor" in who) headers[DEMO_VISITOR_HEADER] = who.visitor;
  return app.request(path, init);
}

const asA: Who = { user: A };
const asB: Who = { user: B };
const asDemo: Who = { demo: true };
const visitor1: Who = { visitor: randomUUID() };
const visitor2: Who = { visitor: randomUUID() };

const day = new Date().toISOString().slice(0, 10);
const range = () => {
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const from = new Date(Date.now() - 6 * 86_400_000).toISOString();
  return new URLSearchParams({ from, to }).toString();
};

// Every read route. Each must answer 2xx (or a clean 4xx) and never carry A's data.
const READS = [
  () => `/v1/timeline?${range()}`,
  () => "/v1/goals",
  () => "/v1/instructions",
  () => "/v1/recommendations",
  () => "/v1/profile",
  () => "/v1/places",
  () => "/v1/privacy",
  () => "/v1/push",
  () => "/v1/chat?limit=200",
  () => `/v1/score?date=${day}`,
  () => `/v1/patterns?${range()}`,
  () => "/v1/moments/morning",
  () => "/v1/moments/evening",
  () => "/v1/nudges",
  () => "/v1/integrations",
  () => "/v1/agents",
  () => "/v1/agents/queries",
  () => "/v1/telegram",
  () => "/v1/goals/suggestions",
  () => "/v1/focus-guards/active",
  () => "/v1/voice",
  () => "/v1/places/suggestions",
  () => "/v1/records",
  () => "/v1/sources/status",
  () => "/v1/targets/current",
];

const ids: { goal?: string; instruction?: string; rec?: string; recBefore?: string } = {};

async function ok(res: Response, what: string) {
  const text = await res.text();
  assert.ok(res.status < 300, `${what}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

test("A writes through every write route", async () => {
  const event = {
    source: "manual",
    type: "note",
    start_at: new Date(Date.now() - 3_600_000).toISOString(),
    title: `${MARK} event`,
  };
  await ok(await request(asA, "POST", "/v1/events", event), "POST /v1/events");
  await ok(
    await request(asA, "POST", "/v1/events/batch", {
      events: [{ ...event, title: `${MARK} batch`, external_id: `a-${A}` }],
    }),
    "POST /v1/events/batch",
  );
  const goal = await ok(
    await request(asA, "POST", "/v1/goals", {
      category: "work",
      title: `${MARK} goal`,
      weekly_budget_minutes: 300,
    }),
    "POST /v1/goals",
  );
  ids.goal = goal.id;
  await ok(
    await request(asA, "PATCH", `/v1/goals/${goal.id}`, { description: `${MARK} description` }),
    "PATCH /v1/goals",
  );
  const instruction = await ok(
    await request(asA, "POST", "/v1/instructions", { text: `${MARK} keep Sundays clear` }),
    "POST /v1/instructions",
  );
  ids.instruction = instruction.id;
  await ok(
    await request(asA, "PUT", "/v1/profile", {
      weak_spots: [],
      quiet_hours: { start: "21:13", end: "06:47" },
    }),
    "PUT /v1/profile",
  );
  await ok(
    await request(asA, "PUT", "/v1/places", {
      places: [{ key: "home", label: `${MARK} home`, lat: 37.98, lng: 23.72 }],
    }),
    "PUT /v1/places",
  );
  await ok(
    await request(asA, "PUT", "/v1/privacy/off-the-record", { off_the_record: true }),
    "off the record",
  );
  await ok(await request(asA, "PATCH", "/v1/privacy/sources/chrome", { enabled: false }), "source switch");
  await ok(
    await request(asA, "POST", "/v1/push/subscriptions", {
      endpoint: `https://push.example.com/${A}`,
      keys: { p256dh: "k", auth: "a" },
    }),
    "POST /v1/push/subscriptions",
  );
  // Recommendations start as the same mock list for every in-memory user: A dismisses one.
  const { recommendations } = await ok(await request(asA, "GET", "/v1/recommendations"), "recs");
  const rec = recommendations.find((r: { status: string }) => r.status === "proposed");
  ids.rec = rec.id;
  ids.recBefore = rec.status;
  await ok(await request(asA, "PATCH", `/v1/recommendations/${rec.id}`, { status: "dismissed" }), "dismiss");
  // Chat (the route needs a model, so the line is stored the way the route stores it).
  await runAsUser(A, () => store.addChatMessage("user", `${MARK} chat`), "session");
});

for (const [name, who] of [
  ["user B", asB],
  ["the demo account", asDemo],
  ["a demo visitor", visitor1],
] as const) {
  test(`${name} reads nothing of A's through any route`, async () => {
    for (const path of READS) {
      const p = path();
      const res = await request(who, "GET", p);
      const text = await res.text();
      assert.ok(res.status < 500, `GET ${p} as ${name}: ${res.status} ${text}`);
      assert.ok(!text.includes(MARK), `GET ${p} as ${name} leaked A's data`);
      assert.ok(!text.includes(A), `GET ${p} as ${name} leaked A's id`);
    }
    for (const p of [`/v1/goals/${ids.goal}`]) {
      assert.equal((await request(who, "GET", p)).status, 404, `GET ${p} as ${name}`);
    }
    const privacy = await (await request(who, "GET", "/v1/privacy")).json();
    assert.equal(privacy.off_the_record, false, `A's off the record must not apply to ${name}`);
    const push = await (await request(who, "GET", "/v1/push")).json();
    assert.equal(push.devices, 0, `${name} must not count A's device`);
  });

  test(`${name} cannot change or delete A's data`, async () => {
    const tries: [string, string, unknown?][] = [
      ["PATCH", `/v1/goals/${ids.goal}`, { title: "taken" }],
      ["DELETE", `/v1/goals/${ids.goal}`],
      ["PATCH", `/v1/instructions/${ids.instruction}`, { text: "taken over" }],
      ["DELETE", `/v1/instructions/${ids.instruction}`],
    ];
    for (const [method, path, body] of tries) {
      const res = await request(who, method, path, body);
      assert.ok([403, 404].includes(res.status), `${method} ${path} as ${name}: ${res.status}`);
    }
    // Same id, other account: B's own copy changes, never A's.
    await request(who, "PATCH", `/v1/recommendations/${ids.rec}`, { status: "proposed" });
  });
}

test("A's data is all still there and unchanged", async () => {
  // The reads above are only meaningful if A's own reads do carry the marker.
  for (const p of [`/v1/timeline?${range()}`, "/v1/goals", "/v1/instructions", "/v1/places", "/v1/chat"]) {
    const text = await (await request(asA, "GET", p)).text();
    assert.ok(text.includes(MARK), `A should see their own data at ${p}`);
  }
  const goal = await ok(await request(asA, "GET", `/v1/goals/${ids.goal}`), "A's goal");
  assert.equal(goal.title, `${MARK} goal`);
  const { instructions } = await ok(await request(asA, "GET", "/v1/instructions"), "A's instructions");
  assert.ok(instructions.some((i: { text: string }) => i.text === `${MARK} keep Sundays clear`));
  const { recommendations } = await ok(await request(asA, "GET", "/v1/recommendations"), "A's recs");
  assert.equal(recommendations.find((r: { id: string }) => r.id === ids.rec).status, "dismissed");
  const { messages } = await ok(await request(asA, "GET", "/v1/chat"), "A's chat");
  assert.deepEqual(
    messages.map((m: { content: string }) => m.content),
    [`${MARK} chat`],
  );
  assert.equal((await ok(await request(asA, "GET", "/v1/privacy"), "A's privacy")).off_the_record, true);
  assert.equal((await ok(await request(asA, "GET", "/v1/push"), "A's push")).devices, 1);
});

async function mcpAs(userId: string, via: AuthMethod) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  await runAsUser(userId, () => server.connect(serverSide), via);
  const client = new Client({ name: "isolation", version: "0" });
  await client.connect(clientSide);
  return client;
}

for (const [name, userId] of [
  ["user B", B],
  ["the demo account", DEMO],
] as const) {
  test(`${name} sees nothing of A's through any MCP tool`, () =>
    runAsUser(userId, async () => {
      const client = await mcpAs(userId, "script");
      const call = async (tool: string, args: Record<string, unknown> = {}) => {
        const res = (await client.callTool({ name: tool, arguments: args })) as {
          content: { text: string }[];
          structuredContent?: unknown;
          isError?: boolean;
        };
        return { ...res, all: JSON.stringify(res) };
      };
      const reads: [string, Record<string, unknown>][] = [
        ["get_timeline", {}],
        ["get_goals", { active_only: false }],
        ["get_instructions", { active_only: false }],
        ["get_score", {}],
        ["get_patterns", {}],
        ["list_recommendations", {}],
        ["get_nudges", {}],
        ["get_moments", { kind: "morning" }],
        ["get_moments", { kind: "evening" }],
        ["propose_goals", {}],
        ["get_records", {}],
      ];
      const { tools } = await client.listTools();
      for (const t of tools.filter((x) => x.annotations?.readOnlyHint)) {
        assert.ok(
          reads.some(([n]) => n === t.name),
          `read tool ${t.name} is not covered by the isolation test`,
        );
      }
      for (const [tool, args] of reads) {
        const res = await call(tool, args);
        assert.ok(!res.all.includes(MARK), `${tool} as ${name} leaked A's data`);
      }
      // Writes aimed at A's rows find nothing.
      const update = await call("update_goal", { id: ids.goal, title: "taken" });
      assert.ok(update.isError, `update_goal on A's goal as ${name} must fail`);
      await call("update_recommendation", { id: ids.rec, status: "proposed" });
      // add_event and add_goal land in the caller's own account.
      await call("add_goal", { category: "rest", title: `${name} own goal` });
    }));
}

test("A's rows survive the MCP attempts", async () => {
  const goal = await ok(await request(asA, "GET", `/v1/goals/${ids.goal}`), "A's goal");
  assert.equal(goal.title, `${MARK} goal`);
  const { goals } = await ok(await request(asA, "GET", "/v1/goals"), "A's goals");
  assert.ok(!goals.some((g: { title: string }) => g.title.endsWith("own goal")));
  const { recommendations } = await ok(await request(asA, "GET", "/v1/recommendations"), "A's recs");
  assert.equal(recommendations.find((r: { id: string }) => r.id === ids.rec).status, "dismissed");
});

// ---------- demo visitors ----------

const say = (who: { visitor: string }, text: string) =>
  runAsUser(DEMO, () => store.addChatMessage("user", text), "demo_visitor", undefined, who.visitor);

test("two demo visitors never see each other's chat, nor the account's own", async () => {
  await runAsUser(DEMO, () => store.addChatMessage("user", "the account's own line"), "api_key");
  await say(visitor1, "visitor one asks");
  await say(visitor2, "visitor two asks");

  const read = async (who: Who) =>
    ((await ok(await request(who, "GET", "/v1/chat"), "chat")).messages as { content: string }[]).map(
      (m) => m.content,
    );
  assert.deepEqual(await read(visitor1), ["visitor one asks"]);
  assert.deepEqual(await read(visitor2), ["visitor two asks"]);
  assert.deepEqual(await read(asDemo), ["the account's own line"]);
});

test("demo visitors cannot change the shared account", async () => {
  const refused: [string, string, unknown?][] = [
    ["PUT", "/v1/privacy/off-the-record", { off_the_record: true }],
    ["PATCH", "/v1/privacy/sources/chrome", { enabled: false }],
    ["POST", "/v1/goals", { category: "work", title: "mine now" }],
    ["PATCH", "/v1/goals/00000000-0000-4000-8000-000000000001", { active: false }],
    ["DELETE", "/v1/goals/00000000-0000-4000-8000-000000000001"],
    ["POST", "/v1/instructions", { text: "keep Mondays clear" }],
    ["PUT", "/v1/profile", { weak_spots: [] }],
    ["PUT", "/v1/places", { places: [] }],
    ["POST", "/v1/tokens", { name: "Mac" }],
    ["GET", "/v1/tokens"],
    ["POST", "/v1/integrations/google_calendar/connect"],
    ["DELETE", "/v1/integrations/google_calendar"],
    ["POST", "/v1/telegram/link"],
    ["DELETE", "/v1/telegram"],
    ["PATCH", `/v1/agents/${randomUUID()}`, { status: "revoked" }],
    ["POST", "/v1/demo/reseed"],
    [
      "POST",
      "/v1/events",
      { source: "manual", type: "note", start_at: new Date().toISOString(), title: "x" },
    ],
    ["POST", "/v1/nudges/check"],
    ["DELETE", "/v1/me/data"],
    ["DELETE", `/v1/events/${randomUUID()}`],
    ["POST", `/v1/goals/suggestions/${randomUUID()}/accept`],
    ["PUT", "/v1/targets/2026-11-09", {}],
    ["POST", "/v1/setup-tokens", { connection: "mac" }],
    ["POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }],
    ["POST", "/v1/webhooks/omi", {}],
  ];
  for (const [method, path, body] of refused) {
    const res = await request(visitor1, method, path, body);
    assert.equal(res.status, 403, `${method} ${path} as a demo visitor: ${res.status}`);
    const json = (await res.json()) as { error: { message: string } };
    assert.equal(json.error.message, DEMO_VISITOR_MESSAGE);
  }
  const privacy = await ok(await request(asDemo, "GET", "/v1/privacy"), "demo privacy");
  assert.equal(privacy.off_the_record, false);
});

test("demo visitors can still chat, act on recommendations and turn on nudges", async () => {
  // Past the guard: chat answers 503 only because no model is configured in tests.
  const chat = await request(visitor1, "POST", "/v1/chat", { message: "hello" });
  assert.notEqual(chat.status, 403);
  const { recommendations } = await ok(await request(visitor1, "GET", "/v1/recommendations"), "recs");
  const rec = recommendations[0] as { id: string };
  assert.notEqual(
    (await request(visitor1, "PATCH", `/v1/recommendations/${rec.id}`, { status: "dismissed" })).status,
    403,
  );
  assert.notEqual((await request(visitor1, "POST", `/v1/recommendations/${rec.id}/execute`)).status, 403);
  assert.notEqual((await request(visitor1, "POST", `/v1/recommendations/${rec.id}/undo`)).status, 403);
  const push = await request(visitor1, "POST", "/v1/push/subscriptions", {
    endpoint: `https://push.example.com/${randomUUID()}`,
    keys: { p256dh: "k", auth: "a" },
  });
  assert.equal(push.status, 201);
});

test("a malformed visitor id is refused, and the API key alone keeps full access", async () => {
  const bad = await app.request("/v1/goals", {
    headers: { authorization: `Bearer ${env.API_KEY}`, [DEMO_VISITOR_HEADER]: "everyone" },
  });
  assert.equal(bad.status, 401);
  // A visitor header without the API key means nothing: still unauthorised.
  const noKey = await app.request("/v1/goals", { headers: { [DEMO_VISITOR_HEADER]: randomUUID() } });
  assert.equal(noKey.status, 401);
  const on = await request(asDemo, "PUT", "/v1/privacy/off-the-record", { off_the_record: true });
  assert.equal(on.status, 200);
  const off = await request(asDemo, "PUT", "/v1/privacy/off-the-record", { off_the_record: false });
  assert.equal(off.status, 200);
});

test("the demo reseed clears visitor chat and puts off the record back off", async () => {
  await say(visitor1, "before the reseed");
  await runAsUser(DEMO, () => store.setOffTheRecord(true), "api_key");
  await runAsUser(DEMO, () => seedDemoWeek(store, { overwriteGoals: true }), "api_key");
  const chat = await ok(await request(visitor1, "GET", "/v1/chat"), "visitor chat");
  assert.deepEqual(chat.messages, []);
  const own = await ok(await request(asDemo, "GET", "/v1/chat"), "account chat");
  assert.deepEqual(
    own.messages.map((m: { content: string }) => m.content),
    ["the account's own line"],
    "the account's own chat (Claude, scripts) stays",
  );
  const privacy = await ok(await request(asDemo, "GET", "/v1/privacy"), "privacy");
  assert.equal(privacy.off_the_record, false);
});

test("the visitor rules fail closed for routes nobody listed", () => {
  assert.equal(demoVisitorMay("POST", "/v1/something-new"), false);
  assert.equal(demoVisitorMay("DELETE", "/v1/me/data"), false);
  assert.equal(demoVisitorMay("GET", "/v1/goals"), true);
  assert.equal(demoVisitorMay("POST", "/v1/chat/"), true);
});
