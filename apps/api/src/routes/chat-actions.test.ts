import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { ChatHistory, ChatResponse, ChatStep, Recommendation } from "@michael/shared";
import { FALLBACK_STEP, goalIdOf, stepLabel } from "../actions/chat-steps";
import { CHAT_TOOLS } from "../actions/chat-tools";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { withoutInstructions } from "../instructions/testkit";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { store } from "../store";
import { askMichael, setChatClientForTests } from "./chat";

const HOUR = 3600_000;
const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const iso = (ms: number) => new Date(ms).toISOString();
const clock = (ms: number) => new Zone(DEFAULT_TIMEZONE).clock(ms);
// A fresh user without standing instructions: these tests book relative to now, and on a Saturday
// "tomorrow" is the mock's clear Sunday (instructions/guard.test.ts covers the guard).
const asNewUser = <T>(fn: () => Promise<T>) =>
  runAsUser(randomUUID(), async () => {
    await withoutInstructions(store);
    return fn();
  });

type Reply = { text?: string; tool?: { name: string; input: unknown } };

const message = (r: Reply, i: number) =>
  ({
    stop_reason: r.tool ? "tool_use" : "end_turn",
    content: [
      ...(r.text ? [{ type: "text", text: r.text }] : []),
      ...(r.tool ? [{ type: "tool_use", id: `toolu_${i}`, name: r.tool.name, input: r.tool.input }] : []),
    ],
  }) as unknown as Anthropic.Message;

/** A stand in for Claude that answers with the scripted turns in order and keeps every request. */
function fakeClaude(replies: Reply[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  let i = 0;
  const next = (params: Anthropic.MessageCreateParams) => {
    // Copy: the loop keeps appending to the same array.
    requests.push({ ...params, messages: [...params.messages] });
    const r = replies[i] ?? { text: "Nothing more to add." };
    return message(r, i++);
  };
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParams) => next(params),
      stream: (params: Anthropic.MessageCreateParams) => {
        const m = next(params);
        return {
          async *[Symbol.asyncIterator]() {
            for (const b of m.content) {
              if (b.type === "text") {
                yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: b.text } };
              }
            }
          },
          finalMessage: async () => m,
        };
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

/** The tool_result blocks the loop sent back in the last request. */
function toolResults(req: Anthropic.MessageCreateParams | undefined) {
  const last = req?.messages.at(-1);
  const blocks = (Array.isArray(last?.content) ? last.content : []) as Anthropic.ContentBlockParam[];
  return blocks.filter((b) => b.type === "tool_result") as Anthropic.ToolResultBlockParam[];
}

async function withClaude<T>(replies: Reply[], fn: (r: Anthropic.MessageCreateParams[]) => Promise<T>) {
  const { client, requests } = fakeClaude(replies);
  setChatClientForTests(client);
  try {
    return await fn(requests);
  } finally {
    setChatClientForTests(null);
  }
}

const turns = (text: string): Anthropic.MessageParam[] => [{ role: "user", content: text }];

test("chat creates a focus block: a done chat recommendation, the block on the timeline, and the undo time", () =>
  asNewUser(() => {
    const start = Date.now() + 3 * HOUR;
    return withClaude(
      [
        {
          tool: {
            name: "create_focus_block",
            input: { title: "Focus: pitch", start_at: iso(start), end_at: iso(start + HOUR) },
          },
        },
        { text: `Done. Focus: pitch from ${clock(start)} to ${clock(start + HOUR)}.` },
      ],
      async (requests) => {
        const { answer, actions } = await askMichael(turns("Block an hour for the pitch"), "context");
        assert.equal(actions.length, 1);
        const rec = Recommendation.parse(actions[0]);
        assert.equal(rec.status, "done");
        assert.equal(rec.source, "chat");
        assert.equal(rec.action?.kind, "create_focus_block");
        // The model did not say the undo line, so Michael adds it.
        assert.match(answer, new RegExp(`Undo until ${clock(start)}\\.$`));

        // The tools went to the model, and the result came back to it as a tool_result.
        assert.ok(requests[0]?.tools?.some((t) => "name" in t && t.name === "move_calendar_block"));
        const [result] = toolResults(requests[1]);
        assert.equal(result?.is_error, undefined);
        assert.match(String(result?.content), /Done: Focus: pitch/);

        const [block] = await store.listEvents({
          from: iso(start - HOUR),
          to: iso(start + 2 * HOUR),
          source: ["agent"],
        });
        assert.equal(block?.title, "Focus: pitch");
        // It shows with the other recommendations (Today), as done.
        const listed = await store.listRecommendations({ status: "done" });
        assert.ok(listed.some((r) => r.id === rec.id));
      },
    );
  }));

test("chat moves the user's own block, and undo_action puts it back", () =>
  asNewUser(async () => {
    const start = Date.now() + 4 * HOUR;
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(start),
        end_at: iso(start + HOUR),
        title: "Gym",
        data: {},
      },
    ]);
    const gym = inserted[0];
    assert.ok(gym);
    const later = start + 2 * HOUR;

    const moved = await withClaude(
      [
        { tool: { name: "move_calendar_block", input: { event_id: gym.id, start_at: iso(later) } } },
        { text: `Moved Gym to ${clock(later)}. Undo until ${clock(start)}.` },
      ],
      () => askMichael(turns("Move the gym two hours later"), "context"),
    );
    assert.equal(moved.actions[0]?.status, "done");
    assert.equal(moved.answer, `Moved Gym to ${clock(later)}. Undo until ${clock(start)}.`);
    const after = await store.getEvent(gym.id);
    assert.equal(Date.parse(after?.start_at ?? ""), later);
    assert.equal(Date.parse(after?.end_at ?? ""), later + HOUR);

    const recId = moved.actions[0]?.id ?? "";
    const undone = await withClaude(
      [{ tool: { name: "undo_action", input: { recommendation_id: recId } } }, { text: "Put it back." }],
      () => askMichael(turns("Undo that"), "context"),
    );
    assert.equal(undone.actions[0]?.status, "undone");
    assert.equal(undone.answer, "Put it back.");
    assert.equal(Date.parse((await store.getEvent(gym.id))?.start_at ?? ""), start);
  }));

test("chat refuses to move an event with other people: the model hears the 409, nothing changes", () =>
  asNewUser(async () => {
    const start = Date.now() + 5 * HOUR;
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(start),
        end_at: iso(start + HOUR),
        title: "Standup",
        data: { with_others: true, attendees: 4 },
      },
    ]);
    const standup = inserted[0];
    assert.ok(standup);
    await withClaude(
      [
        {
          tool: {
            name: "move_calendar_block",
            input: { event_id: standup.id, start_at: iso(start + HOUR) },
          },
        },
        { text: "That one has other people in it, so I only advise: ask the team to start at 15:00." },
      ],
      async (requests) => {
        const { answer, actions } = await askMichael(turns("Move the standup"), "context");
        assert.deepEqual(actions, []);
        assert.doesNotMatch(answer, /Undo until/);
        const [result] = toolResults(requests[1]);
        assert.equal(result?.is_error, true);
        assert.match(String(result?.content), /conflict.*other people/);
      },
    );
    assert.equal((await store.getEvent(standup.id))?.start_at, standup.start_at);
    // The refused try does not linger on Today as something to do.
    assert.deepEqual(
      (await store.listRecommendations()).filter((r) => r.source === "chat").map((r) => r.status),
      ["dismissed"],
    );
  }));

test("chat never creates a block that has already started", () =>
  asNewUser(() =>
    withClaude(
      [
        {
          tool: {
            name: "create_focus_block",
            input: { title: "Late", start_at: iso(Date.now() - HOUR), end_at: iso(Date.now() + HOUR) },
          },
        },
        { text: "That time has started, so I left it." },
      ],
      async (requests) => {
        const { actions } = await askMichael(turns("Block the last hour"), "context");
        assert.deepEqual(actions, []);
        assert.match(String(toolResults(requests[1])[0]?.content), /already started/);
      },
    ),
  ));

test("POST /v1/chat/stream sends an action event, then the reply with its actions", async () => {
  // The demo account (the API key) starts with the mock "Keep Sundays clear", and six hours from
  // a Saturday evening is Sunday: this test is about streaming, so it starts without it.
  await runAsUser(env.DEMO_USER_ID, () => withoutInstructions(store));
  const start = Date.now() + 6 * HOUR;
  await withClaude(
    [
      {
        text: "On it.",
        tool: {
          name: "create_focus_block",
          input: { title: "Lunch", start_at: iso(start), end_at: iso(start + HOUR / 2) },
        },
      },
      { text: "Lunch is in." },
    ],
    async () => {
      const res = await app.request("/v1/chat/stream", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ message: "Put lunch in" }),
      });
      assert.equal(res.status, 200);
      const events = (await res.text())
        .trim()
        .split("\n\n")
        .map((block) => ({
          event: /^event: (.*)$/m.exec(block)?.[1],
          data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null"),
        }));
      const kinds = events.map((e) => e.event);
      assert.ok(kinds.indexOf("action") > -1 && kinds.indexOf("action") < kinds.indexOf("done"));
      const action = Recommendation.parse(events.find((e) => e.event === "action")?.data);
      assert.equal(action.status, "done");
      const body = ChatResponse.parse(events.at(-1)?.data);
      assert.equal(body.actions[0]?.id, action.id);
      const expected = `On it.\n\nLunch is in. Undo until ${clock(start)}.`;
      assert.equal(body.reply.content, expected);
      // The streamed text is exactly what was stored.
      const streamed = events
        .filter((e) => e.event === "delta")
        .map((e) => e.data.text)
        .join("");
      assert.equal(streamed, expected);
      // The answer remembers what it did, so the Undo chip comes back after a reload.
      assert.deepEqual(body.reply.action_ids, [action.id]);
      const history = ChatHistory.parse(await (await app.request("/v1/chat", { headers: auth })).json());
      const stored = history.messages.find((m) => m.id === body.reply.id);
      assert.deepEqual(stored?.action_ids, [action.id]);
      assert.equal(history.messages.find((m) => m.id === body.message.id)?.action_ids.length, 0);
      assert.equal(history.actions.find((a) => a.id === action.id)?.status, "done");
    },
  );
});

test("a spoken answer asks Claude to be brief and listless; a typed one does not", () =>
  withClaude(
    [{ text: "Forty seven minutes so far." }, { text: "Two hours this week." }],
    async (requests) => {
      const system = (r: Anthropic.MessageCreateParams | undefined) =>
        (Array.isArray(r?.system) ? r.system : []).map((b) => b.text).join("\n");
      const ask = (body: object) =>
        app.request("/v1/chat", { method: "POST", headers: auth, body: JSON.stringify(body) });
      assert.equal((await ask({ message: "How much deep work today?", spoken: true })).status, 201);
      assert.match(system(requests[0]), /spoken aloud/);
      assert.equal((await ask({ message: "And this week?" })).status, 201);
      assert.doesNotMatch(system(requests[1]), /spoken aloud/);
    },
  ));

test("every chat tool has its own plain step label; unknown tools get the fallback", () => {
  for (const tool of CHAT_TOOLS) {
    const label = stepLabel(tool.name, {});
    assert.notEqual(label, FALLBACK_STEP, tool.name);
    assert.ok(label.split(" ").length <= 6, label);
    assert.doesNotMatch(label, /[\u2013\u2014_]|-/, label);
  }
  assert.equal(stepLabel("something_new", { title: "Dinner with Anna" }), FALLBACK_STEP);
  assert.equal(stepLabel("log_day", { results: [{ minutes: 30 }, { minutes: 10 }] }), "Logging 40 min");
  assert.equal(stepLabel("log_done", { minutes: 40, goal: "Gym" }), "Logging 40 min");
  assert.equal(stepLabel("block_mac_app", { apps: ["WhatsApp"] }), "Blocking WhatsApp");
  assert.equal(stepLabel("block_mac_app", { apps: ["WhatsApp", "Slack"] }), "Blocking distracting apps");
  assert.equal(stepLabel("block_mac_app", { apps: ["<script>"] }), "Blocking distracting apps");
  // Titles and ids in the input never reach the label.
  assert.equal(
    stepLabel("move_calendar_block", { event_id: "abc123", new_title: "Call with Anna" }),
    "Moving your block",
  );
});

test("step labels name the user's own goal when the call points at it, and fall back otherwise", () => {
  assert.equal(stepLabel("log_done", { minutes: 40, goal_id: "g" }, "70.3"), "Logging 40 min to 70.3");
  assert.equal(stepLabel("create_focus_block", { goal_id: "g" }, "Deep work"), "Booking time for Deep work");
  assert.equal(stepLabel("focus_now", { goal_id: "g" }, "University"), "Starting focus on University");
  // One named app still says more than the goal.
  assert.equal(stepLabel("block_mac_app", { apps: ["Slack"], goal_id: "g" }, "Deep work"), "Blocking Slack");
  // An odd or long goal name, or none, falls back to the plain label.
  assert.equal(stepLabel("create_focus_block", { goal_id: "g" }, "<b>x</b>"), "Booking the block");
  assert.equal(stepLabel("create_focus_block", { goal_id: "g" }, "x".repeat(40)), "Booking the block");
  assert.equal(stepLabel("log_done", { minutes: 40, goal: "Gym with Anna" }), "Logging 40 min");
  // Tools that do not point at a goal never look one up.
  assert.equal(goalIdOf("move_calendar_block", { goal_id: "g" }), null);
  assert.equal(goalIdOf("log_done", { goal_id: "g" }), "g");
});

test("a streamed answer looks the goal up in the user's own goals for its step label", () =>
  asNewUser(async () => {
    const goal = await store.createGoal({
      category: "health",
      title: "Gym",
      weekly_budget_minutes: 180,
      active: true,
    });
    await withClaude(
      [{ tool: { name: "log_done", input: { goal_id: goal.id, minutes: 40 } } }, { text: "Logged." }],
      async () => {
        const steps: ChatStep[] = [];
        await askMichael(turns("Gym for 40 minutes"), "context", {
          onText: async () => {},
          onStep: async (s) => {
            steps.push(s);
          },
        });
        assert.deepEqual(
          steps.map((s) => `${s.label}:${s.status}`),
          ["Logging 40 min to Gym:running", "Logging 40 min to Gym:done"],
        );
      },
    );
  }));

test("POST /v1/chat/stream opens with Reading your day, then a running and done step per tool, in order", async () => {
  await runAsUser(env.DEMO_USER_ID, () => withoutInstructions(store));
  await withClaude(
    [{ tool: { name: "what_you_know", input: {} } }, { text: "Here is what I know." }],
    async () => {
      const res = await app.request("/v1/chat/stream", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ message: "What do you know about me?" }),
      });
      assert.equal(res.status, 200);
      const events = (await res.text())
        .trim()
        .split("\n\n")
        .map((block) => ({
          event: /^event: (.*)$/m.exec(block)?.[1],
          data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null"),
        }));
      assert.equal(events[0]?.event, "step");
      const steps = events.filter((e) => e.event === "step").map((e) => ChatStep.parse(e.data));
      assert.deepEqual(
        steps.map((s) => `${s.label}:${s.status}`),
        [
          "Reading your day:running",
          "Reading your day:done",
          "Checking what I know:running",
          "Checking what I know:done",
        ],
      );
      assert.equal(steps[2]?.id, steps[3]?.id);
      const kinds = events.map((e) => e.event);
      assert.ok(kinds.lastIndexOf("step") < kinds.indexOf("delta"));
      assert.equal(kinds.at(-1), "done");
    },
  );
});
