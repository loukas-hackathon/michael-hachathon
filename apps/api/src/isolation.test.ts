import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hono } from "hono";
import { app, v1Routes } from "./app";
import { type AuthMethod, runAsUser } from "./context";
import { seedDemoWeek } from "./demo/sync";
import {
  DEMO_PRESENTER_HEADER,
  DEMO_VISITOR_HEADER,
  DEMO_VISITOR_MESSAGE,
  demoVisitorMay,
} from "./demo/visitor";
import { env } from "./env";
import { errorResponse, HttpError } from "./http";
import { createMcpServer } from "./mcp";
import { remember } from "./memory";
import { threadFor } from "./routes/chat-threads";
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
  () => "/v1/location",
  () => "/v1/privacy",
  () => "/v1/push",
  () => "/v1/chat?limit=200",
  () => "/v1/chat/threads",
  () => `/v1/chat/threads?q=${encodeURIComponent(MARK)}`,
  () => `/v1/chat?thread_id=${ids.thread}`,
  () => `/v1/score?date=${day}`,
  () => `/v1/patterns?${range()}`,
  () => "/v1/insights",
  () => "/v1/moments/morning",
  () => "/v1/moments/evening",
  () => "/v1/nudges",
  () => "/v1/integrations",
  () => "/v1/agents",
  () => "/v1/agents/queries",
  () => "/v1/telegram",
  () => "/v1/goals/suggestions",
  () => "/v1/focus-guards/active",
  () => "/v1/focus/active",
  () => "/v1/voice",
  () => "/v1/places/suggestions",
  () => "/v1/records",
  () => "/v1/sources/status",
  () => "/v1/me/knowledge",
  () => "/v1/targets/current",
  () => `/v1/checklist?date=${day}`,
  () => "/v1/meetings/active",
];

const ids: {
  goal?: string;
  instruction?: string;
  rec?: string;
  recBefore?: string;
  item?: string;
  thread?: string;
  log?: string;
  block?: string;
} = {};

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
  // Done time (#317): the entry lands on A's timeline and in A's score only.
  const logged = await ok(
    await request(asA, "POST", "/v1/log", { goal_id: goal.id, minutes: 30, note: `${MARK} logged` }),
    "POST /v1/log",
  );
  ids.log = logged.entry.id;
  // A block on the Timeline (#271), tomorrow so it can still change. Before off the record, which stops new events.
  const block = await ok(
    await request(asA, "POST", "/v1/blocks", {
      start_at: new Date(Date.now() + 26 * 3_600_000).toISOString(),
      end_at: new Date(Date.now() + 27 * 3_600_000).toISOString(),
      title: `${MARK} block`,
    }),
    "POST /v1/blocks",
  );
  ids.block = block.event.id;
  const instruction = await ok(
    await request(asA, "POST", "/v1/instructions", { text: `${MARK} keep Sundays clear` }),
    "POST /v1/instructions",
  );
  ids.instruction = instruction.id;
  // A checklist goal and one of the day's outcomes (#238).
  const outcomes = await ok(
    await request(asA, "POST", "/v1/goals", {
      category: "business",
      title: "Outcomes",
      target: { kind: "checklist" },
    }),
    "POST /v1/goals (checklist)",
  );
  const item = await ok(
    await request(asA, "POST", "/v1/checklist", { goal_id: outcomes.id, date: day, text: `${MARK} outcome` }),
    "POST /v1/checklist",
  );
  ids.item = item.id;
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
  // Where A was: a visit from A's phone position.
  await ok(
    await request(asA, "POST", "/v1/location/signals", {
      signals: [{ kind: "point", at: new Date(Date.now() - 600_000).toISOString(), lat: 37.98, lng: 23.72 }],
    }),
    "POST /v1/location/signals",
  );
  // Meetings mode (#400): A's session must not show for, or open conversations of, anyone else.
  await ok(await request(asA, "POST", "/v1/meetings/start", { consent: true }), "POST /v1/meetings/start");
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
  // Chat: a thread through the route, then a line the way the chat route stores it (it needs a model).
  const thread = await ok(
    await request(asA, "POST", "/v1/chat/threads", { title: `${MARK} thread` }),
    "POST /v1/chat/threads",
  );
  ids.thread = thread.id;
  await runAsUser(A, () => store.addChatMessage(thread.id, "user", `${MARK} chat`), "session");
  // A memory, as the chat's remember tool keeps it.
  await runAsUser(A, () => remember(`${MARK} trains before 08:00`, "chat"), "session");
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
    const meetings = await (await request(who, "GET", "/v1/meetings/active")).json();
    assert.equal(meetings.active, null, `A's meeting must not run for ${name}`);
  });

  test(`${name} cannot change or delete A's data`, async () => {
    const tries: [string, string, unknown?][] = [
      ["PATCH", `/v1/goals/${ids.goal}`, { title: "taken" }],
      ["DELETE", `/v1/goals/${ids.goal}`],
      ["PATCH", `/v1/instructions/${ids.instruction}`, { text: "taken over" }],
      ["DELETE", `/v1/instructions/${ids.instruction}`],
      ["PATCH", `/v1/blocks/${ids.block}`, { title: "taken over" }],
      ["DELETE", `/v1/blocks/${ids.block}`],
      ["PATCH", `/v1/checklist/${ids.item}`, { status: "done" }],
      ["POST", `/v1/checklist/${ids.item}/carry`],
      ["DELETE", `/v1/checklist/${ids.item}`],
      ["PATCH", `/v1/chat/threads/${ids.thread}`, { title: "taken" }],
      ["DELETE", `/v1/chat/threads/${ids.thread}`],
      ["POST", "/v1/chat", { message: "into A's thread", thread_id: ids.thread }],
      ["DELETE", `/v1/log/${ids.log}`],
      ["POST", "/v1/log", { goal_id: ids.goal, minutes: 10 }],
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
  for (const p of [
    `/v1/timeline?${range()}`,
    "/v1/goals",
    "/v1/instructions",
    "/v1/places",
    "/v1/chat",
    "/v1/chat/threads",
    `/v1/chat/threads?q=${encodeURIComponent(MARK)}`,
    `/v1/checklist?date=${day}`,
  ]) {
    const text = await (await request(asA, "GET", p)).text();
    assert.ok(text.includes(MARK), `A should see their own data at ${p}`);
  }
  const goal = await ok(await request(asA, "GET", `/v1/goals/${ids.goal}`), "A's goal");
  assert.equal(goal.title, `${MARK} goal`);
  const { instructions } = await ok(await request(asA, "GET", "/v1/instructions"), "A's instructions");
  assert.ok(instructions.some((i: { text: string }) => i.text === `${MARK} keep Sundays clear`));
  const { recommendations } = await ok(await request(asA, "GET", "/v1/recommendations"), "A's recs");
  assert.equal(recommendations.find((r: { id: string }) => r.id === ids.rec).status, "dismissed");
  const { messages, thread } = await ok(await request(asA, "GET", "/v1/chat"), "A's chat");
  assert.deepEqual(
    messages.map((m: { content: string }) => m.content),
    [`${MARK} chat`],
  );
  assert.equal(thread.title, `${MARK} thread`, "A's thread kept its name");
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
        ["get_insights", {}],
        ["list_recommendations", {}],
        ["get_nudges", {}],
        ["get_moments", { kind: "morning" }],
        ["get_moments", { kind: "evening" }],
        ["propose_goals", {}],
        ["get_records", {}],
        ["get_week_review", {}],
        ["get_check_in", {}],
        ["get_memories", {}],
        ["what_you_know", {}],
        ["list_drafts", {}],
        ["get_checklist", { date: day }],
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
      const logged = await call("log_done", { goal_id: ids.goal, minutes: 10 });
      assert.ok(logged.isError, `log_done on A's goal as ${name} must fail`);
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

/** A line in the caller's latest thread (a new one when there is none), as the chat route stores it. */
const line = async (text: string) => {
  const { thread } = await threadFor(undefined);
  return store.addChatMessage(thread.id, "user", text);
};
const say = (who: { visitor: string }, text: string) =>
  runAsUser(DEMO, () => line(text), "demo_visitor", undefined, who.visitor);

test("two demo visitors never see each other's chat, nor the account's own", async () => {
  await runAsUser(DEMO, () => line("the account's own line"), "api_key");
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

test("demo visitors keep threads of their own: make, rename, pin and delete, never another's", async () => {
  const mine = await ok(
    await request(visitor1, "POST", "/v1/chat/threads", { title: "Visitor one plan" }),
    "visitor thread",
  );
  const titles = async (who: Who) =>
    ((await ok(await request(who, "GET", "/v1/chat/threads"), "threads")).threads as { title: string }[]).map(
      (t) => t.title,
    );
  assert.ok((await titles(visitor1)).includes("Visitor one plan"));
  assert.ok(!(await titles(visitor2)).includes("Visitor one plan"));
  assert.ok(!(await titles(asDemo)).includes("Visitor one plan"));
  // The other visitor and the account itself cannot touch it.
  for (const who of [visitor2, asDemo]) {
    assert.equal((await request(who, "PATCH", `/v1/chat/threads/${mine.id}`, { title: "x" })).status, 404);
    assert.equal((await request(who, "DELETE", `/v1/chat/threads/${mine.id}`)).status, 404);
    assert.equal((await request(who, "GET", `/v1/chat?thread_id=${mine.id}`)).status, 404);
  }
  const pinned = await ok(
    await request(visitor1, "PATCH", `/v1/chat/threads/${mine.id}`, { title: "Exam week", pinned: true }),
    "rename",
  );
  assert.equal(pinned.title, "Exam week");
  assert.equal(pinned.pinned, true);
  const gone = await ok(await request(visitor1, "DELETE", `/v1/chat/threads/${mine.id}`), "delete");
  assert.equal(gone.messages, 0);
  assert.ok(!(await titles(visitor1)).includes("Exam week"));
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
    // Connecting an agent grants full write: never from the shared demo week.
    ["POST", `/v1/connect/requests/${randomUUID()}`, { allow: true }],
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
  // Book on Goals is a stage beat: undoable like Do it, so a visitor may press it (and Undo it).
  const { goals } = await ok(await request(visitor1, "GET", "/v1/goals"), "goals");
  const goal = (goals as { id: string }[])[0];
  assert.ok(goal, "the demo account has goals");
  const book = await request(visitor1, "POST", `/v1/goals/${goal.id}/book`, { minutes: 30 });
  assert.notEqual(book.status, 403, `Book as a demo visitor: ${book.status}`);
  assert.ok(demoVisitorMay("POST", `/v1/goals/${goal.id}/book`));
  assert.ok(!demoVisitorMay("POST", "/v1/goals"));
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

test("the presenter path: the API key alone may still answer a connect request", async () => {
  // An unknown request is 404, not 403: the route is open to the key (docs/demo-runbook.md).
  const res = await request(asDemo, "POST", `/v1/connect/requests/${randomUUID()}`, { allow: true });
  assert.equal(res.status, 404);
});

test("the demo reseed puts goals and standing instructions back to the plan", async () => {
  const { demoGoals, demoInstructions } = await import("./demo/week");
  const plan = demoGoals[0] as { id: string; title: string };
  // Rehearsal changes, made the ways that still can: Claude or the API key.
  await ok(await request(asDemo, "POST", "/v1/goals", { category: "rest", title: "Rehearsal goal" }), "add");
  await ok(await request(asDemo, "PATCH", `/v1/goals/${plan.id}`, { title: "Renamed" }), "rename");
  await ok(await request(asDemo, "POST", "/v1/instructions", { text: "Rehearsal rule" }), "rule");

  await runAsUser(DEMO, () => seedDemoWeek(store, { overwriteGoals: true }), "api_key");

  const { goals } = await ok(await request(asDemo, "GET", "/v1/goals"), "goals");
  // The plan is the demo goals plus the ritual's outcomes goal, which the reseed writes again (#318).
  const { OUTCOMES_TITLE } = await import("./ritual/ritual");
  assert.deepEqual(
    goals
      .filter((g: { title: string }) => g.title !== OUTCOMES_TITLE)
      .map((g: { id: string }) => g.id)
      .sort(),
    demoGoals.map((g) => g.id).sort(),
  );
  assert.ok(!goals.some((g: { title: string }) => g.title === "Rehearsal goal"));
  assert.equal(goals.find((g: { id: string }) => g.id === plan.id).title, plan.title);
  const { instructions } = await ok(await request(asDemo, "GET", "/v1/instructions"), "instructions");
  assert.deepEqual(
    instructions.map((i: { text: string }) => i.text),
    demoInstructions.map((i) => i.text),
  );
});

// ---------- the presenter (#343) ----------

const PRESENTER_KEY = "test-presenter-key"; // test-env.ts

/** A pending claude.ai connect request, made the way claude.ai makes one. Returns its id. */
async function pendingConnectRequest(): Promise<string> {
  const reg = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    }),
  });
  const { client_id } = (await reg.json()) as { client_id: string };
  const q = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
    state: "s",
  });
  const res = await app.request(`/oauth/authorize?${q}`);
  const id = new URL(res.headers.get("location") ?? "").searchParams.get("request");
  assert.ok(id, `authorize: ${res.status}`);
  return id;
}

/** A connect decision with the given headers (the API key is added unless `key` is given). */
const decide = (id: string, headers: Record<string, string>) =>
  app.request(`/v1/connect/requests/${id}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.API_KEY}`, "content-type": "application/json", ...headers },
    body: JSON.stringify({ allow: true }),
  });

test("the presenter may answer the claude.ai consent; a plain visitor may not", async () => {
  const id = await pendingConnectRequest();
  const visitor = { [DEMO_VISITOR_HEADER]: randomUUID() };
  assert.equal((await decide(id, visitor)).status, 403);
  const res = await decide(id, { ...visitor, [DEMO_PRESENTER_HEADER]: PRESENTER_KEY });
  const { redirect_to } = await ok(res, "presenter allows");
  assert.ok(new URL(redirect_to).searchParams.get("code"), "a code goes back to claude.ai");
  // Nothing else opens up for the presenter: the shared account stays as it is.
  const goal = await app.request("/v1/goals", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.API_KEY}`,
      "content-type": "application/json",
      ...visitor,
      [DEMO_PRESENTER_HEADER]: PRESENTER_KEY,
    },
    body: JSON.stringify({ category: "rest", title: "presenter goal" }),
  });
  assert.equal(goal.status, 403);
});

test("a visitor cannot escalate: a wrong, empty or borrowed presenter key is still a visitor", async () => {
  const id = await pendingConnectRequest();
  const visitor = { [DEMO_VISITOR_HEADER]: randomUUID() };
  for (const wrong of ["", "wrong", `${PRESENTER_KEY}x`, env.API_KEY, PRESENTER_KEY.toUpperCase()]) {
    const res = await decide(id, { ...visitor, [DEMO_PRESENTER_HEADER]: wrong });
    assert.equal(res.status, 403, `presenter header ${JSON.stringify(wrong)}: ${res.status}`);
  }
  // Still pending: none of those answered it.
  const read = await request(asDemo, "GET", `/v1/connect/requests/${id}`);
  assert.equal(read.status, 200);
});

test("the presenter key means nothing without the API key", async () => {
  const id = await pendingConnectRequest();
  const presenter = { [DEMO_PRESENTER_HEADER]: PRESENTER_KEY, [DEMO_VISITOR_HEADER]: randomUUID() };
  // No credentials, the presenter key in place of the API key, or a made up token: unauthorised.
  for (const authorization of [undefined, `Bearer ${PRESENTER_KEY}`, "Bearer not-a-token"]) {
    const headers: Record<string, string> = { "content-type": "application/json", ...presenter };
    if (authorization) headers.authorization = authorization;
    const res = await app.request(`/v1/connect/requests/${id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ allow: true }),
    });
    assert.equal(res.status, 401, `${authorization ?? "no auth"}: ${res.status}`);
  }
  const read = await request(asDemo, "GET", `/v1/connect/requests/${id}`);
  assert.equal(read.status, 200, "still pending");
});

test("demo visitors may save the ritual and log time on stage; the reseed puts both back to the plan", async () => {
  const { demoGoals } = await import("./demo/week");
  await runAsUser(DEMO, () => seedDemoWeek(store, { overwriteGoals: true }), "api_key");
  const tri = demoGoals.find((g) => g.title === "70.3") as { id: string };
  const ritualBefore = await ok(await request(asDemo, "GET", "/v1/ritual"), "ritual before");
  const textsBefore = (ritualBefore.items as { text: string }[]).map((i) => i.text).sort();

  const logged = await request(visitor1, "POST", "/v1/log", {
    goal_id: tri.id,
    minutes: 20,
    note: "Stage swim",
  });
  assert.equal(logged.status, 201);
  const entry = (await logged.json()).entry as { id: string };
  const second = await ok(
    await request(visitor1, "POST", "/v1/log", { goal_id: tri.id, minutes: 10, note: "Stage run" }),
    "second log",
  );
  assert.equal((await request(visitor1, "DELETE", `/v1/log/${second.entry.id}`)).status, 200);
  // Settling a block that is not there is a clean 404, past the visitor guard.
  assert.equal(
    (await request(visitor1, "POST", "/v1/log/block", { event_id: randomUUID(), did: true })).status,
    404,
  );
  // The ritual: a morning save (refused only if today is full) and Not today on the evening.
  const morning = await request(visitor1, "POST", "/v1/ritual/morning", {
    outcomes: [{ text: "Visitor outcome" }],
  });
  assert.notEqual(morning.status, 403);
  assert.notEqual((await request(visitor1, "POST", "/v1/ritual/evening/skip")).status, 403);

  await runAsUser(DEMO, () => seedDemoWeek(store, { overwriteGoals: true }), "api_key");

  assert.equal(await runAsUser(DEMO, () => store.getEvent(entry.id), "api_key"), null);
  const ritualAfter = await ok(await request(asDemo, "GET", "/v1/ritual"), "ritual after");
  assert.deepEqual((ritualAfter.items as { text: string }[]).map((i) => i.text).sort(), textsBefore);
  assert.notEqual(ritualAfter.evening, "skipped");
  // The demo week's own logged entry stays.
  const from = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const { events } = await ok(
    await request(asDemo, "GET", `/v1/timeline?${new URLSearchParams({ from, to })}`),
    "timeline",
  );
  assert.ok(
    (events as { external_id: string | null; data: { log?: string } }[]).some(
      (e) => e.data.log === "done" && e.external_id?.startsWith("demo:"),
    ),
  );
});

test("the visitor rules fail closed for routes nobody listed", () => {
  assert.equal(demoVisitorMay("POST", "/v1/log"), true);
  assert.equal(demoVisitorMay("POST", "/v1/log/block"), true);
  assert.equal(demoVisitorMay("DELETE", "/v1/log/x"), true);
  assert.equal(demoVisitorMay("POST", "/v1/ritual/morning"), true);
  assert.equal(demoVisitorMay("POST", "/v1/ritual/evening/skip"), true);
  assert.equal(demoVisitorMay("POST", "/v1/ritual/other"), false);
  // The chat screen warming Michael up (#364): it only reads.
  assert.equal(demoVisitorMay("POST", "/v1/chat/warm"), true);
  assert.equal(demoVisitorMay("POST", "/v1/chat/other"), false);
  assert.equal(demoVisitorMay("POST", "/v1/connect/requests/x"), false);
  assert.equal(demoVisitorMay("POST", "/v1/connect/requests/x", true), true);
  assert.equal(demoVisitorMay("POST", "/v1/goals", true), false);
  assert.equal(demoVisitorMay("POST", "/mcp", true), false);
  // Off the record: the presenter's privacy beat on stage, never a plain visitor.
  assert.equal(demoVisitorMay("PUT", "/v1/privacy/off-the-record"), false);
  assert.equal(demoVisitorMay("PUT", "/v1/privacy/off-the-record", true), true);
  assert.equal(demoVisitorMay("PATCH", "/v1/privacy/sources/apple_health", true), false);
  assert.equal(demoVisitorMay("POST", "/v1/something-new"), false);
  assert.equal(demoVisitorMay("DELETE", "/v1/me/data"), false);
  assert.equal(demoVisitorMay("GET", "/v1/goals"), true);
  assert.equal(demoVisitorMay("POST", "/v1/chat/"), true);
});

test("focus sessions (#397): only their owner sees, extends or ends one; visitors keep their own", async () => {
  const goalOf = async (who: Who, title: string) =>
    (
      await ok(
        await request(who, "POST", "/v1/goals", {
          category: "personal",
          title,
          description: null,
          target: null,
          weekly_budget_minutes: 300,
          active: true,
        }),
        `goal ${title}`,
      )
    ).id as string;
  const aGoal = await goalOf(asA, `Focus ${MARK}`);
  const bGoal = await goalOf(asB, "Focus of B");
  // A is off the record from the first test: nothing is kept, so no session either.
  assert.equal((await request(asA, "POST", "/v1/focus/start", { goal_id: aGoal })).status, 409);
  await ok(await request(asA, "PUT", "/v1/privacy/off-the-record", { off_the_record: false }), "A back on");
  const started = await request(asA, "POST", "/v1/focus/start", { goal_id: aGoal, minutes: 25 });
  assert.equal(started.status, 201, await started.clone().text());
  const session = (await started.json()) as { id: string; event_id: string };

  // B cannot read, extend or end A's session, nor start one on A's goal.
  const bActive = await ok(await request(asB, "GET", "/v1/focus/active"), "B active");
  assert.equal(bActive.session, null);
  assert.ok(!JSON.stringify(bActive).includes(MARK));
  assert.equal((await request(asB, "POST", `/v1/focus/${session.id}/extend`, {})).status, 404);
  assert.equal((await request(asB, "POST", `/v1/focus/${session.id}/end`, { count: true })).status, 404);
  assert.equal((await request(asB, "POST", "/v1/focus/start", { goal_id: aGoal })).status, 404);
  // B's own session runs beside A's: one per user, not one in all.
  assert.equal((await request(asB, "POST", "/v1/focus/start", { goal_id: bGoal, minutes: 25 })).status, 201);
  // A second one for A is refused.
  assert.equal((await request(asA, "POST", "/v1/focus/start", { goal_id: aGoal, minutes: 25 })).status, 409);

  // Demo visitors: allowed, one each, never another's.
  await runAsUser(DEMO, () => seedDemoWeek(store, { overwriteGoals: true }), "api_key");
  const { demoGoals } = await import("./demo/week");
  const uni = demoGoals.find((g) => g.title === "University") ?? demoGoals[0];
  const v1Start = await request(visitor1, "POST", "/v1/focus/start", { goal_id: uni?.id, minutes: 25 });
  assert.equal(v1Start.status, 201, await v1Start.clone().text());
  const v1Session = (await v1Start.json()) as { id: string; event_id: string };
  const v2Active = await ok(await request(visitor2, "GET", "/v1/focus/active"), "visitor 2 active");
  assert.equal(v2Active.session, null);
  assert.equal((await request(visitor2, "POST", `/v1/focus/${v1Session.id}/end`, {})).status, 404);
  const accountActive = await ok(await request(asDemo, "GET", "/v1/focus/active"), "account active");
  assert.equal(accountActive.session, null);
  const extended = await ok(
    await request(visitor1, "POST", `/v1/focus/${v1Session.id}/extend`, {}),
    "extend",
  );
  assert.equal(extended.minutes, 40);

  // The reseed clears visitors' sessions and the blocks they made on the demo day.
  await runAsUser(DEMO, () => seedDemoWeek(store, { overwriteGoals: true }), "api_key");
  const after = await ok(await request(visitor1, "GET", "/v1/focus/active"), "visitor 1 after reseed");
  assert.equal(after.session, null);
  assert.equal(await runAsUser(DEMO, () => store.getEvent(v1Session.event_id), "api_key"), null);

  // A's session is untouched by all of it, and A can end it.
  const aActive = await ok(await request(asA, "GET", "/v1/focus/active"), "A active");
  assert.equal(aActive.session?.id, session.id);
  const ended = await ok(
    await request(asA, "POST", `/v1/focus/${session.id}/end`, { count: false }),
    "A end",
  );
  assert.equal(ended.status, "ended");
  assert.equal(demoVisitorMay("POST", "/v1/focus/start"), true);
  assert.equal(demoVisitorMay("POST", "/v1/goals/from-words"), true);
  assert.equal(demoVisitorMay("POST", "/v1/onboarding/turn"), true);
  assert.equal(demoVisitorMay("POST", "/v1/focus/x/end"), true);
  assert.equal(demoVisitorMay("POST", "/v1/focus/x/delete"), false);
});
