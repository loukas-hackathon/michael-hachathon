import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type AgentClient, mockRecommendations, type Recommendation, voiceProblems } from "@michael/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { agentsStore } from "./agents-store";
import { runAsUser } from "./context";
import { withoutInstructions } from "./instructions/testkit";
import { createMcpServer } from "./mcp";
import { toInstant, zone } from "./mcp-format";
import { logLine, outcomeOf, shortReason, summarise, TOOL_SCOPE } from "./mcp-guard";
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
// The booking tests book "tomorrow", which on a Saturday is the mock's clear Sunday: they start
// without standing instructions (instructions/guard.test.ts covers the guard).
const asNewUserWithoutRules = <T>(fn: () => Promise<T>) =>
  asNewUser(async () => {
    await withoutInstructions(store);
    return fn();
  });

const text = (r: Result) => r.content.map((c) => c.text).join("\n");
// Tomorrow at a local wall time, so the block is always in the future.
const tomorrow = (hhmm: string) => `${zone.nextDay(zone.dayOf(Date.now()))}T${hhmm}`;

const TOOLS = [
  "add_checklist_item",
  "add_event",
  "add_goal",
  "answer_check_in",
  "block_mac_app",
  "confirm_block",
  "create_focus_block",
  "draft_follow_up",
  "execute_recommendation",
  "get_check_in",
  "get_checklist",
  "get_goals",
  "get_instructions",
  "get_memories",
  "get_moments",
  "get_nudges",
  "get_patterns",
  "get_records",
  "get_score",
  "get_timeline",
  "list_drafts",
  "list_recommendations",
  "log_day",
  "log_done",
  "plan_travel",
  "propose_goals",
  "remember",
  "set_day_outcomes",
  "suggest_app_mute",
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
    for (const name of [
      "get_goals",
      "get_instructions",
      "get_score",
      "get_records",
      "get_nudges",
      "get_timeline",
      "list_recommendations",
    ]) {
      const r = await call(name);
      assert.notEqual(r.isError, true, `${name}: ${text(r)}`);
      assert.ok(text(r).length > 0);
      assert.ok(r.structuredContent, `${name} has structured content`);
    }
    const goals = await call("get_goals");
    assert.match(text(goals), /a week/);
    // The three categories, and what a goal measures when it is not time.
    assert.match(text(goals), /- business: "4h of deep work per day", 20h a week/);
    assert.match(text(goals), /- health: "Sleep 7.5h\+", .*a target goal/);
    assert.match(text(goals), /- personal: "Evenings out"/);
    // Standing instructions: the user's ground rules, active ones only.
    const rules = await call("get_instructions");
    assert.match(text(rules), /1 standing instructions:\n- "Keep Sundays clear" \(clear_day, id /);
    assert.deepEqual(
      (
        (rules.structuredContent?.instructions ?? []) as { text: string; kind: string; days?: number[] }[]
      ).map((i) => [i.text, i.kind, i.days]),
      [["Keep Sundays clear", "clear_day", [0]]],
    );
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
  asNewUserWithoutRules(async () => {
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
  asNewUserWithoutRules(async () => {
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
  asNewUserWithoutRules(async () => {
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

test("block_mac_app mutes an allowlisted app now, shows in Michael and can be undone", () =>
  asNewUser(async () => {
    const { call } = await connect();
    const r = await call("block_mac_app", {
      apps: ["WhatsApp"],
      end: new Date(Date.now() + 3600_000).toISOString(),
    });
    assert.equal(r.isError, undefined, text(r));
    assert.match(text(r), /Muted: "Mute WhatsApp/);
    const rec = r.structuredContent?.recommendation as Recommendation;
    assert.equal(rec.status, "done");
    assert.equal(rec.action?.kind, "block_mac_app");
    const { guards } = await (await import("./actions/focus-guard")).activeFocusGuards();
    assert.deepEqual(guards[0]?.apps, ["WhatsApp"]);

    const undone = await call("undo_recommendation", { id: rec.id });
    assert.equal(undone.isError, undefined, text(undone));
    assert.equal((await (await import("./actions/focus-guard")).activeFocusGuards()).guards.length, 0);

    const refused = await call("block_mac_app", {
      apps: ["Finder"],
      end: new Date(Date.now() + 3600_000).toISOString(),
    });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /not on my list/);
  }));

test("add_checklist_item and get_checklist keep the day's outcomes (#238)", () =>
  asNewUserWithoutRules(async () => {
    const { call } = await connect();
    const goal = await store.createGoal({
      category: "business",
      title: "Today's outcomes",
      target: { kind: "checklist" },
      active: true,
    });
    const date = "2027-03-02";
    const added = await call("add_checklist_item", { goal_id: goal.id, text: "Send the deck", date });
    assert.ok(!added.isError, text(added));
    assert.match(text(added), /Added "Send the deck" to Tue 2 Mar/);
    for (const t of ["Two", "Three"]) await call("add_checklist_item", { goal_id: goal.id, text: t, date });
    const fourth = await call("add_checklist_item", { goal_id: goal.id, text: "Four", date });
    assert.equal(fourth.isError, true);
    assert.match(text(fourth), /Three open items is the most/);
    // A goal that is not a checklist is refused with the reason.
    const timeGoal = await store.createGoal({ category: "business", title: "Deep work", active: true });
    const wrong = await call("add_checklist_item", { goal_id: timeGoal.id, text: "x", date });
    assert.equal(wrong.isError, true);

    const got = await call("get_checklist", { date });
    assert.ok(!got.isError);
    assert.match(text(got), /Tue 2 Mar: 0 of 3 done\./);
    assert.match(text(got), /\[open\] Send the deck \(Today's outcomes, id /);
    assert.equal((got.structuredContent?.items as unknown[] | undefined)?.length, 3);
    assert.equal(
      summarise("add_checklist_item", undefined, { text: "Send the deck" }),
      'Added "Send the deck" to your outcomes',
    );
  }));

test("set_day_outcomes and log_day run the daily ritual without a checklist goal (#318)", () =>
  asNewUserWithoutRules(async () => {
    await store.deleteMyData({ everything: true });
    const { call } = await connect();
    const set = await call("set_day_outcomes", { outcomes: [{ text: "Send the deck" }, { text: "Gym" }] });
    assert.ok(!set.isError, text(set));
    assert.match(text(set), /^Today's outcomes, 2 of 3:\n- Send the deck \(id /);
    const items = (set.structuredContent?.items ?? []) as { id: string }[];
    const logged = await call("log_day", {
      results: [
        { item_id: items[0]?.id, result: "done" },
        { item_id: items[1]?.id, result: "not", carry: true },
      ],
    });
    assert.ok(!logged.isError, text(logged));
    assert.equal(text(logged), "1 of 2 done. One carried to tomorrow.");
    assert.equal(
      summarise("set_day_outcomes", undefined, { outcomes: [{}, {}] }),
      "Set 2 outcomes for today",
    );
    assert.equal(summarise("log_day", undefined, {}), "Logged what you got done today");
  }));

// ---------- the log says what happened (#330) ----------

const claude = (): AgentClient => ({
  id: randomUUID(),
  name: "Claude",
  status: "approved",
  scopes: ["timeline", "goals", "write_events"],
  created_at: new Date().toISOString(),
  last_seen_at: null,
});
const logOf = async (agent: AgentClient) =>
  (
    await agentsStore.listQueries({
      from: new Date(Date.now() - 60_000).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
    })
  ).filter((q) => q.agent_id === agent.id);

test("a refused booking is logged as tried and refused, and only a real change counts as one", () => {
  const agent = claude();
  return asNewUser(async () => {
    await withoutInstructions(store);
    const { call } = await connect();
    const lineFor = async (title: string) =>
      (await logOf(agent)).find((q) => q.summary.includes(`"${title}"`));

    const past = await call("create_focus_block", {
      start: new Date(Date.now() - 3600_000).toISOString(),
      end: new Date(Date.now() + 3600_000).toISOString(),
      title: "Past",
    });
    assert.equal(past.isError, true);
    const refused = await lineFor("Past");
    assert.match(
      refused?.summary ?? "",
      /^Tried to book "Past" for \w{3} \d\d:\d\d\. Refused: already started\.$/,
    );
    assert.equal(refused?.allowed, true);
    assert.equal(refused?.changed, false);
    assert.equal(refused?.recommendation_id, null);

    await store.insertEvents([
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
    const clash = await call("create_focus_block", {
      start: tomorrow("14:30"),
      end: tomorrow("16:00"),
      title: "Clash",
    });
    assert.equal(clash.isError, true);
    const clashed = await lineFor("Clash");
    assert.match(
      clashed?.summary ?? "",
      /^Tried to book "Clash" for \w{3} 14:30\. Refused: it overlaps an event with other people\.$/,
    );
    assert.doesNotMatch(clashed?.summary ?? "", /Investor/, "the line never names someone else's event");
    assert.equal(clashed?.changed, false);

    // A standing instruction says no: the reason is Michael's own line.
    const weekday = new Date(`${tomorrow("12:00")}:00Z`).getUTCDay();
    await store.createInstruction({
      text: "Keep it clear",
      kind: "clear_day",
      days: [weekday],
      active: true,
    });
    const kept = await call("create_focus_block", {
      start: tomorrow("09:00"),
      end: tomorrow("10:00"),
      title: "Rule",
    });
    assert.equal(kept.isError, true);
    assert.match(
      (await lineFor("Rule"))?.summary ?? "",
      /^Tried to book "Rule" for \w{3} 09:00\. Refused: \w+days are kept clear\.$/,
    );
    await withoutInstructions(store);

    const booked = await call("create_focus_block", {
      start: tomorrow("09:00"),
      end: tomorrow("10:00"),
      title: "Real",
    });
    assert.notEqual(booked.isError, true, text(booked));
    const done = await lineFor("Real");
    assert.match(done?.summary ?? "", /^Booked "Real" for \w{3} 09:00$/);
    assert.equal(done?.changed, true);
    const rec = booked.structuredContent?.recommendation as Recommendation | undefined;
    assert.equal(done?.recommendation_id, rec?.id);
    assert.ok(rec?.id);

    await call("get_goals");
    const read = (await logOf(agent)).find((q) => q.tool === "get_goals");
    assert.equal(read?.summary, "Read your goals");
    assert.equal(read?.changed, null);

    // What the Agents screen counts: the changes, not the attempts.
    const log = await logOf(agent);
    assert.equal(log.length, 5);
    assert.equal(log.filter((q) => q.changed).length, 1);
  }, agent);
});

test("a write with nothing to do is logged as nothing changed; a scope refusal changes nothing", () => {
  const agent = { ...claude(), scopes: ["timeline", "write_events"] as AgentClient["scopes"] };
  return asNewUser(async () => {
    const { call } = await connect();
    const note = { source: "agent", type: "note", start_at: new Date().toISOString(), title: "Ran 5 km" };
    assert.notEqual((await call("add_event", { ...note, external_id: "run-1" })).isError, true);
    assert.notEqual((await call("add_event", { ...note, external_id: "run-1" })).isError, true);
    await call("add_goal", { category: "health", title: "Run" });
    const log = await logOf(agent);
    assert.deepEqual(log.map((q) => [q.summary, q.allowed, q.changed]).sort(), [
      ['Added "Ran 5 km" to your day', true, true],
      ['Added the goal "Run"', false, false],
      ['Tried to add "Ran 5 km" to your day. Nothing changed: already on your timeline.', true, false],
    ]);
  }, agent);
});

test("outcomeOf, shortReason and logLine: every tool's line turns into what was tried", () => {
  const refusal = (said: string) => ({ isError: true, content: [{ type: "text", text: said }] });
  assert.deepEqual(outcomeOf("get_timeline", true, { content: [] }), { changed: null, failed: null });
  assert.deepEqual(outcomeOf("add_goal", false, { structuredContent: { goal: {} } }), {
    changed: true,
    failed: null,
  });
  assert.deepEqual(outcomeOf("create_focus_block", false, refusal("That time has already started")), {
    changed: false,
    failed: { how: "Refused", reason: "already started" },
  });
  assert.deepEqual(outcomeOf("get_timeline", true, refusal("Validation failed: from: bad")), {
    changed: null,
    failed: { how: "Refused", reason: "the request was not valid" },
  });
  assert.deepEqual(outcomeOf("remember", false, { structuredContent: { memory: null } }).failed, {
    how: "Nothing changed",
    reason: "you are off the record",
  });
  assert.deepEqual(outcomeOf("create_focus_block", false, undefined, true), {
    changed: false,
    failed: { how: "Failed", reason: "an error on my side" },
  });

  assert.equal(shortReason("You're home by 21:00."), "you're home by 21:00");
  assert.equal(shortReason("Sundays are kept clear."), "Sundays are kept clear");
  assert.equal(shortReason("That one is done. Undo it with undo_recommendation first."), "that one is done");
  assert.equal(shortReason('No goal called "bath". Your goals: Sales, Gym'), "no goal by that name");
  assert.equal(shortReason("I log the last 14 days only"), "I log the last 14 days only");
  assert.equal(shortReason("A block is at most 6 hours"), "a block is at most 6 hours");
  assert.equal(shortReason(""), "it did not go through");

  const failed = { changed: false, failed: { how: "Refused" as const, reason: "already started" } };
  assert.equal(
    logLine("Carried out my advice on your calendar", failed),
    "Tried to carry out my advice on your calendar. Refused: already started.",
  );
  assert.equal(logLine("Read your goals", { changed: null, failed: null }), "Read your goals");
  // Every tool has a summary that reads after "Tried to": none falls back to its title.
  for (const name of new Set([...TOOLS, ...Object.keys(TOOL_SCOPE)])) {
    const line = logLine(summarise(name, undefined, {}), failed);
    assert.match(line, /^Tried to [a-z]/, name);
    assert.doesNotMatch(line, /^Tried to use /, name);
    assert.deepEqual(voiceProblems(line), [], name);
  }
});
