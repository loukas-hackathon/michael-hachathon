import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type AgentClient, mockRecommendations, type Recommendation } from "@michael/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runAsUser } from "./context";
import { createMcpServer } from "./mcp";
import { toInstant, zone } from "./mcp-format";
import { summarise } from "./mcp-guard";
import { store } from "./store";

// Every tool is called through the real MCP server, in process, as a fresh user each test.

type Result = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

const [, CREATE_ID, NO_ACTION_ID] = mockRecommendations.map((r) => r.id) as [string, string, string];

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return {
    client,
    call: async (name: string, args: Record<string, unknown> = {}) =>
      (await client.callTool({ name, arguments: args })) as Result,
  };
}

const asNewUser = <T>(fn: () => Promise<T>, agent?: AgentClient) =>
  runAsUser(randomUUID(), fn, agent ? "mcp_oauth" : "script", agent);

const text = (r: Result) => r.content.map((c) => c.text).join("\n");
// Tomorrow at a local wall time, so the block is always in the future.
const tomorrow = (hhmm: string) => `${zone.nextDay(zone.dayOf(Date.now()))}T${hhmm}`;

const TOOLS = [
  "add_event",
  "add_goal",
  "create_focus_block",
  "execute_recommendation",
  "get_goals",
  "get_moments",
  "get_nudges",
  "get_patterns",
  "get_score",
  "get_timeline",
  "list_recommendations",
  "plan_travel",
  "undo_recommendation",
  "update_goal",
  "update_recommendation",
];

test("the tool set is complete and every tool explains itself", () =>
  asNewUser(async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS);
    for (const t of tools) assert.ok((t.description ?? "").length > 80, `${t.name} needs a real description`);
  }));

test("reads answer with short text and structured content", () =>
  asNewUser(async () => {
    const { call } = await connect();
    for (const name of ["get_goals", "get_score", "get_nudges", "get_timeline", "list_recommendations"]) {
      const r = await call(name);
      assert.notEqual(r.isError, true, `${name}: ${text(r)}`);
      assert.ok(text(r).length > 0);
      assert.ok(r.structuredContent, `${name} has structured content`);
    }
    const goals = await call("get_goals");
    assert.match(text(goals), /a week/);
    const moment = await call("get_moments", { kind: "evening" });
    assert.notEqual(moment.isError, true, text(moment));
    assert.match(text(moment), /^Evening/);
    const score = await call("get_score");
    const day = score.structuredContent?.day as { blocks: Record<string, unknown>[] };
    assert.ok(
      day.blocks.every((b) => !("ticks" in b)),
      "ticks are left out for models",
    );
  }));

test("add_goal and update_goal keep the user's goals; pausing never deletes", () =>
  asNewUser(async () => {
    const { call } = await connect();
    const added = await call("add_goal", {
      category: "gym",
      title: "Swim twice",
      weekly_budget_minutes: 120,
    });
    assert.notEqual(added.isError, true, text(added));
    const goal = added.structuredContent?.goal as { id: string };
    assert.match(text(added), /"Swim twice", 2h a week/);

    const changed = await call("update_goal", { id: goal.id, weekly_budget_minutes: 180 });
    assert.match(text(changed), /Weekly budget 2h to 3h/);
    const paused = await call("update_goal", { id: goal.id, active: false });
    assert.match(text(paused), /paused/);
    assert.equal((await store.getGoal(goal.id))?.active, false);

    const missing = await call("update_goal", { id: randomUUID(), title: "x" });
    assert.equal(missing.isError, true);
    assert.match(text(missing), /Goal not found/);
  }));

test("update_recommendation accepts and dismisses, but never a done one", () =>
  asNewUser(async () => {
    const { call } = await connect();
    const list = await call("list_recommendations");
    assert.match(text(list), /Advice only\./);
    assert.match(text(list), /Can carry out: create_focus_block/);

    const accepted = await call("update_recommendation", { id: NO_ACTION_ID, status: "accepted" });
    assert.match(text(accepted), /as accepted/);
    assert.equal((await store.getRecommendation(NO_ACTION_ID))?.status, "accepted");

    const rec = (await store.getRecommendation(NO_ACTION_ID)) as Recommendation;
    rec.status = "done";
    const refused = await call("update_recommendation", { id: NO_ACTION_ID, status: "dismissed" });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /undo_recommendation/);
  }));

test("execute_recommendation and undo_recommendation go through the calendar actions", () =>
  asNewUser(async () => {
    const { call } = await connect();
    const rec = (await store.getRecommendation(CREATE_ID)) as Recommendation;
    const start = toInstant(tomorrow("15:00"));
    rec.action = {
      kind: "create_focus_block",
      payload: { start_at: start, end_at: toInstant(tomorrow("16:30")), title: "Focus: pitch" },
      involves_others: false,
      undo_until: null,
    };

    const done = await call("execute_recommendation", { id: CREATE_ID });
    assert.notEqual(done.isError, true, text(done));
    assert.match(text(done), /Done: "Block 15:00 to 16:30.*15:00 to 16:30\. Undo .* until .*15:00\./);
    assert.equal((await store.getRecommendation(CREATE_ID))?.status, "done");

    const again = await call("execute_recommendation", { id: CREATE_ID });
    assert.equal(again.isError, true);
    assert.match(text(again), /Already done/);

    const undone = await call("undo_recommendation", { id: CREATE_ID });
    assert.notEqual(undone.isError, true, text(undone));
    assert.equal((await store.getRecommendation(CREATE_ID))?.status, "undone");

    // Anything with other people is advice only.
    rec.status = "proposed";
    rec.action = { ...rec.action, involves_others: true };
    const others = await call("execute_recommendation", { id: CREATE_ID });
    assert.equal(others.isError, true);
    assert.match(text(others), /other people/);
  }));

test("create_focus_block books own time in local time, shows in Michael and can be undone", () =>
  asNewUser(async () => {
    const { call } = await connect();
    const booked = await call("create_focus_block", {
      start: tomorrow("10:00"),
      end: tomorrow("11:30"),
      title: "Focus: pitch deck",
    });
    assert.notEqual(booked.isError, true, text(booked));
    assert.match(text(booked), /Booked "Focus: pitch deck" .* 10:00 to 11:30\. Undo .* until .* 10:00\./);
    const rec = booked.structuredContent?.recommendation as Recommendation;
    assert.equal(rec.status, "done");
    assert.match(rec.rationale, /an AI tool/);

    const range = { from: toInstant(tomorrow("09:00")), to: toInstant(tomorrow("12:00")) };
    const blocks = (await store.listEvents(range)).filter((e) => e.data.michael === true);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.start_at, toInstant(tomorrow("10:00")));

    const undone = await call("undo_recommendation", { id: rec.id });
    assert.notEqual(undone.isError, true, text(undone));
    assert.equal((await store.listEvents(range)).filter((e) => e.data.michael === true).length, 0);
  }));

test("create_focus_block refuses the past and time with other people, and leaves their events alone", () =>
  asNewUser(async () => {
    const { call } = await connect();
    const past = await call("create_focus_block", {
      start: new Date(Date.now() - 3600_000).toISOString(),
      end: new Date(Date.now() + 3600_000).toISOString(),
    });
    assert.equal(past.isError, true);
    assert.match(text(past), /already started/);

    const { inserted } = await store.insertEvents([
      {
        source: "google_calendar",
        type: "calendar_event",
        start_at: toInstant(tomorrow("14:00")),
        end_at: toInstant(tomorrow("15:00")),
        title: "Investor call",
        data: { with_others: true, attendees: 3 },
        external_id: `g-${randomUUID()}`,
      },
    ]);
    const before = await store.listRecommendations();
    const clash = await call("create_focus_block", { start: tomorrow("14:30"), end: tomorrow("16:00") });
    assert.equal(clash.isError, true);
    assert.match(text(clash), /"Investor call", which has other people/);
    assert.equal((await store.listRecommendations()).length, before.length, "nothing half made left behind");
    const call_ = await store.getEvent(inserted[0]?.id ?? "");
    assert.equal(call_?.start_at, toInstant(tomorrow("14:00")));

    const long = await call("create_focus_block", { start: tomorrow("08:00"), end: tomorrow("20:00") });
    assert.equal(long.isError, true);
    assert.match(text(long), /at most 6 hours/);
  }));

test("an agent without the scope cannot change the day; the call says why", () => {
  const agent: AgentClient = {
    id: randomUUID(),
    name: "Claude",
    status: "approved",
    scopes: ["timeline", "goals"],
    created_at: new Date().toISOString(),
    last_seen_at: null,
  };
  return asNewUser(async () => {
    const { call } = await connect();
    const r = await call("create_focus_block", { start: tomorrow("10:00"), end: tomorrow("11:00") });
    assert.equal(r.isError, true);
    assert.match(text(r), /Not allowed\. The user has not shared adding to their day with Claude/);
    const goals = await call("get_goals");
    assert.notEqual(goals.isError, true);
  }, agent);
});

test("local times are Europe/Athens wall time; summaries stay plain", () => {
  assert.equal(toInstant("2026-11-14T15:00"), "2026-11-14T13:00:00.000Z");
  assert.equal(toInstant("2026-07-01T15:00"), "2026-07-01T12:00:00.000Z");
  assert.equal(toInstant("2026-11-14T15:00:00+02:00"), "2026-11-14T13:00:00.000Z");
  assert.equal(
    summarise("create_focus_block", undefined, { start: "2026-11-14T15:00", title: "Focus: pitch" }),
    'Booked "Focus: pitch" for Sat 15:00',
  );
  assert.equal(summarise("update_recommendation", undefined, { status: "dismissed" }), "Dismissed my advice");
});
