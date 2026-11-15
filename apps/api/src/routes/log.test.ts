import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { LogTimeResponse, Recommendation } from "@michael/shared";
import { matchGoal, weekMaths } from "../actions/log";
import { app } from "../app";
import { runAsUser } from "../context";
import { demoGoals } from "../demo/week";
import { withoutInstructions } from "../instructions/testkit";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { store } from "../store";
import { askMichael, setChatClientForTests } from "./chat";

// Done time and settled blocks (#317): POST /v1/log, POST /v1/log/block, DELETE /v1/log/:id, and
// the chat tools log_done and confirm_block with a stand in for Claude.

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const zone = new Zone(DEFAULT_TIMEZONE);

/** A fresh user with one goal, "Everything bath", 60 minutes a week, and nothing else. */
async function freshUser<T>(fn: (bathId: string) => Promise<T>): Promise<T> {
  const user = randomUUID();
  return runAsUser(user, async () => {
    await withoutInstructions(store);
    for (const g of await store.listGoals()) await store.deleteGoal(g.id);
    const bath = await store.createGoal({
      category: "personal",
      title: "Everything bath",
      description: null,
      target: null,
      weekly_budget_minutes: 60,
      active: true,
    });
    return fn(bath.id);
  });
}

// The app's own routes, as the signed in user of the surrounding runAsUser.
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { Authorization: "Bearer dev-key", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("matchGoal finds a goal by the user's words, and asks rather than guesses between two", () => {
  const g = (id: string, title: string) =>
    ({
      id,
      title,
      category: "personal",
      description: null,
      target: null,
      weekly_budget_minutes: 60,
      active: true,
      created_at: iso(0),
      updated_at: iso(0),
    }) as const;
  const goals = [
    g(randomUUID(), "Everything bath"),
    g(randomUUID(), "Reading"),
    g(randomUUID(), "Reading club"),
  ];
  assert.equal(matchGoal(goals, { goal: "bath" }).title, "Everything bath");
  assert.equal(matchGoal(goals, { goal: "a BATH" }).title, "Everything bath");
  assert.equal(matchGoal(goals, { goal: "reading" }).title, "Reading");
  assert.throws(() => matchGoal(goals, { goal: "read" }), /Reading or Reading club/);
  assert.throws(() => matchGoal(goals, { goal: "piano" }), /No goal called "piano"/);
});

test("matchGoal reads the user's words against titles, calendar titles and descriptions (#364)", () => {
  // The demo plan: "I took a bath for 40 minutes" lands on 70.3 (recovery is in its description).
  const plan = demoGoals;
  assert.equal(matchGoal(plan, { goal: "bath" }).title, "70.3");
  assert.equal(matchGoal(plan, { goal: "I took a bath for 40 minutes" }).title, "70.3");
  assert.equal(matchGoal(plan, { goal: "ice bath after the ride" }).title, "70.3");
  assert.equal(matchGoal(plan, { goal: "a swim" }).title, "70.3");
  assert.equal(matchGoal(plan, { goal: "bike ride" }).title, "70.3");
  assert.equal(matchGoal(plan, { goal: "revision for the exams" }).title, "University");
  assert.equal(matchGoal(plan, { goal: "cold outreach calls" }).title, "The company");
  // Sleep is measured by nights, never logged; nothing else fits a nap.
  assert.throws(() => matchGoal(plan, { goal: "a nap" }), /No goal called "a nap"/);

  const g = (title: string, description: string | null, calendar_titles?: string[]) =>
    ({
      id: randomUUID(),
      title,
      category: "personal",
      description,
      target: calendar_titles ? { calendar_titles } : null,
      weekly_budget_minutes: 60,
      active: true,
      created_at: iso(0),
      updated_at: iso(0),
    }) as const;
  // A word in a title beats the same word in a description.
  const two = [g("Mobility", "Ten minutes a day"), g("Running", "Easy runs, then mobility work")];
  assert.equal(matchGoal(two, { goal: "foam rolling" }).title, "Mobility");
  // Two goals that fit equally well are a question.
  const tie = [g("Yoga", null), g("Recovery", null)];
  assert.throws(() => matchGoal(tie, { goal: "stretching" }), /Yoga or Recovery/);
});

test("weekMaths shows the maths the user reads", () => {
  assert.equal(weekMaths(40, 60), "40 of 60 min this week");
  assert.equal(weekMaths(130, 540), "2h 10 of 9h this week");
});

test("the routes: POST /v1/log logs past time, refuses the future, DELETE /v1/log/:id takes it back", async () => {
  // The API key is the demo account: give it a goal of its own first.
  const goal = (await (
    await call("POST", "/v1/goals", { category: "personal", title: "Long bath", weekly_budget_minutes: 60 })
  ).json()) as { id: string };
  const res = await call("POST", "/v1/log", { goal_id: goal.id, minutes: 25, note: "With a book" });
  assert.equal(res.status, 201);
  const out = LogTimeResponse.parse(await res.json());
  assert.equal(out.entry.title, "With a book");
  const future = Date.now() + 3600_000;
  const refused = await call("POST", "/v1/log", {
    goal_id: goal.id,
    start_at: iso(future),
    end_at: iso(future + 30 * MIN),
  });
  assert.equal(refused.status, 409);
  assert.equal((await call("POST", "/v1/log", { goal_id: goal.id })).status, 400);
  const undone = await call("DELETE", `/v1/log/${out.entry.id}`);
  assert.equal(Recommendation.parse(await undone.json()).status, "undone");
  assert.equal((await call("DELETE", `/v1/log/${out.entry.id}`)).status, 404);
});

test("logTime and settleBlock through the store: the entry, the maths, undo", () =>
  freshUser(async (bathId) => {
    const { logTime, settleBlock } = await import("../actions/log");
    const { executeRecommendation, undoRecommendation } = await import("../actions/calendar");
    const now = Date.now();

    const out = LogTimeResponse.parse(
      await logTime({ goal: "bath", minutes: 40 }, "app", executeRecommendation),
    );
    assert.equal(out.entry.source, "manual");
    assert.equal(out.entry.type, "focus_session");
    assert.equal(out.entry.data.goal_id, bathId);
    assert.ok(Date.parse(out.entry.end_at as string) <= Date.now());
    assert.equal(out.recommendation.status, "done");
    assert.equal(out.recommendation.action?.kind, "log_time");
    // The maths, as the score has it (the bath may straddle midnight on a test run near it).
    assert.match(out.message, /^Logged\. Everything bath \d+ of 60 min this week\.$/);

    // The future is refused.
    await assert.rejects(
      logTime(
        { goal_id: bathId, start_at: iso(now + 60 * MIN), end_at: iso(now + 90 * MIN) },
        "app",
        executeRecommendation,
      ),
      /not happened yet/,
    );

    // Undo removes the entry.
    await undoRecommendation(out.recommendation.id);
    assert.equal(await store.getEvent(out.entry.id), null);

    // A block of another goal: settled once, then refused, then undone.
    const gym = await store.createGoal({
      category: "health",
      title: "Gym",
      description: null,
      target: { calendar_titles: ["Gym"] },
      weekly_budget_minutes: 180,
      active: true,
    });
    const {
      inserted: [block],
    } = await store.insertEvents([
      {
        source: "google_calendar",
        type: "calendar_event",
        start_at: iso(now - 90 * MIN),
        end_at: iso(now - 30 * MIN),
        title: "Gym",
        data: {},
        external_id: `gym-${randomUUID()}`,
      },
    ]);
    assert.ok(block);
    const settled = await settleBlock(
      { event_id: block.id, did: false, reason: "knee" },
      "app",
      executeRecommendation,
    );
    assert.equal(settled.entry.data.log, "didnt");
    assert.equal(settled.entry.data.goal_id, gym.id);
    assert.match(settled.message, /^Noted, counted as lost\. Gym/);
    await assert.rejects(
      settleBlock({ event_id: block.id, did: true }, "app", executeRecommendation),
      /already settled/,
    );
    await undoRecommendation(settled.recommendation.id);
    const partial = await settleBlock(
      { event_id: block.id, did: true, minutes: 40 },
      "app",
      executeRecommendation,
    );
    assert.equal(Date.parse(partial.entry.end_at as string) - Date.parse(partial.entry.start_at), 40 * MIN);
    assert.match(partial.message, /^Confirmed\. Gym/);
  }));

// ---------- the bath, in chat ----------

type Reply = { text?: string; tool?: { name: string; input: unknown } };

function fakeClaude(replies: Reply[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  let i = 0;
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParams) => {
        requests.push({ ...params, messages: [...params.messages] });
        const r = replies[i] ?? { text: "Nothing more to add." };
        const n = i++;
        return {
          stop_reason: r.tool ? "tool_use" : "end_turn",
          content: [
            ...(r.text ? [{ type: "text", text: r.text }] : []),
            ...(r.tool
              ? [{ type: "tool_use", id: `toolu_${n}`, name: r.tool.name, input: r.tool.input }]
              : []),
          ],
        } as unknown as Anthropic.Message;
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

test("the bath: 'I took a bath for 40 minutes at 13:00' is logged, with the maths and Undo", () =>
  freshUser(async (bathId) => {
    // 13:00 today in Athens, or yesterday when the test runs before 13:40.
    const now = Date.now();
    let day = zone.dayOf(now);
    if (zone.at(day, 13 * 60 + 40) > now) day = zone.nextDay(day, -1);
    const start = zone.at(day, 13 * 60);
    const { client, requests } = fakeClaude([
      { tool: { name: "log_done", input: { goal: "bath", minutes: 40, start_at: iso(start) } } },
      { text: "Logged. Everything bath 40 of 60 min this week. Undo" },
    ]);
    setChatClientForTests(client);
    try {
      const { answer, actions } = await askMichael(
        [{ role: "user", content: "I took a bath for 40 minutes at 13:00" }],
        "context",
      );
      // The tool was offered, and the system prompt no longer lets Michael say he cannot log time.
      const system = JSON.stringify(requests[0]?.system);
      assert.ok(requests[0]?.tools?.some((t) => "name" in t && t.name === "log_done"));
      assert.match(system, /You can always log time against a goal/);
      // A plain statement: the tool's own line is the answer, without a second model call (#364).
      assert.equal(requests.length, 1);
      assert.match(answer, /^Logged\. Everything bath \d+ of 60 min this week\. Undo$/);
      const rec = Recommendation.parse(actions[0]);
      assert.equal(rec.action?.kind, "log_time");
      assert.equal(rec.status, "done");
      const [entry] = (
        await store.listEvents({ from: iso(start), to: iso(start + 40 * MIN), source: ["manual"] })
      ).filter((e) => e.data.goal_id === bathId);
      assert.equal(entry?.start_at, iso(start));
      assert.equal(entry?.end_at, iso(start + 40 * MIN));
    } finally {
      setChatClientForTests(null);
    }
  }));

test("a log with a question still gets the model's answer after the tool (#364)", () =>
  freshUser(async () => {
    const { client, requests } = fakeClaude([
      { tool: { name: "log_done", input: { goal: "bath", minutes: 20 } } },
      { text: "Logged. Everything bath 20 of 60 min this week. Undo. You are on track." },
    ]);
    setChatClientForTests(client);
    try {
      const { answer } = await askMichael(
        [{ role: "user", content: "Had a 20 minute bath, am I on track?" }],
        "context",
      );
      assert.equal(requests.length, 2);
      const last = requests[1]?.messages.at(-1);
      const result = (Array.isArray(last?.content) ? last.content : []).find(
        (b) => b.type === "tool_result",
      ) as Anthropic.ToolResultBlockParam | undefined;
      assert.match(String(result?.content), /Logged\. Everything bath \d+ of 60 min this week\./);
      assert.match(answer, /You are on track/);
    } finally {
      setChatClientForTests(null);
    }
  }));

test("chat write tools: update_goal pauses through an undoable change, deletes nothing", () =>
  freshUser(async (bathId) => {
    const { runChatTool } = await import("../actions/chat-tools");
    const out = await runChatTool("update_goal", { goal_id: bathId, weekly_budget_minutes: 90 });
    assert.equal(out.isError, false);
    assert.equal(out.action?.action?.kind, "change_goal");
    assert.equal((await store.getGoal(bathId))?.weekly_budget_minutes, 90);
    const undone = await runChatTool("undo_action", { recommendation_id: out.action?.id });
    assert.equal(undone.isError, false);
    assert.equal((await store.getGoal(bathId))?.weekly_budget_minutes, 60);
    const refused = await runChatTool("log_done", { goal: "bath" });
    assert.equal(refused.isError, true);
    assert.match(refused.content, /minutes/);
  }));
