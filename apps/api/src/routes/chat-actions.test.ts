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

test("a lasting fact told in chat is remembered, shows on What I know and is in the next answer's context", () =>
  withClaude(
    [
      { tool: { name: "remember", input: { fact: "Sleeps badly after late padel" } } },
      { text: "Noted. I will keep padel early." },
      { text: "Padel before 19:00 then." },
    ],
    async (requests) => {
      const system = (r: Anthropic.MessageCreateParams | undefined) =>
        (Array.isArray(r?.system) ? r.system : []).map((b) => b.text).join("\n");
      const ask = (message: string) =>
        app.request("/v1/chat", { method: "POST", headers: auth, body: JSON.stringify({ message }) });
      // The prompt tells the model to keep lasting facts, and the tool is offered.
      assert.equal((await ask("I sleep badly when I play padel late")).status, 201);
      assert.match(system(requests[0]), /keep it with remember/);
      assert.ok(requests[0]?.tools?.some((t) => "name" in t && t.name === "remember"));
      const [result] = toolResults(requests[1]);
      assert.match(String(result?.content), /^Remembered: Sleeps badly after late padel \(memory_id /);
      // It is on What I know about you, from chat, and forgettable.
      const k = (await (await app.request("/v1/me/knowledge", { headers: auth })).json()) as {
        told: { kind: string; text: string; origin: string; forgettable: boolean }[];
      };
      const mem = k.told.find((i) => i.text === "Sleeps badly after late padel");
      assert.deepEqual([mem?.kind, mem?.origin, mem?.forgettable], ["memory", "chat", true]);
      // The next answer, in any conversation, reads it back.
      assert.equal((await ask("When should I book padel?")).status, 201);
      assert.match(system(requests[2]), /What the user told you before[\s\S]*Sleeps badly after late padel/);
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
  assert.equal(
    stepLabel("focus_now", { goal_id: "g", minutes: 45 }, "University"),
    "Starting 45 min on University",
  );
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

// #457: Michael removes the user's own blocks, with undo until they start.
test('"delete my Boatspace block" removes it, says until when, and undo_action puts it back', () =>
  asNewUser(async () => {
    const start = Date.now() + 5 * HOUR;
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(start),
        end_at: iso(start + HOUR),
        title: "Boatspace",
        data: {},
      },
    ]);
    const boat = inserted[0];
    assert.ok(boat);

    const steps: ChatStep[] = [];
    const removed = await withClaude(
      [{ tool: { name: "remove_calendar_block", input: { event_id: boat.id } } }],
      () =>
        askMichael(turns("delete my Boatspace block"), "context", {
          onText: async () => {},
          onStep: async (s) => {
            steps.push(s);
          },
        }),
    );
    assert.equal(steps[0]?.label, "Removing Boatspace");
    const rec = Recommendation.parse(removed.actions[0]);
    assert.equal(rec.status, "done");
    assert.equal(rec.action?.kind, "remove_calendar_block");
    // A plain statement: the tool's own line is the answer, with what and until when.
    assert.equal(
      removed.answer,
      `Removed Boatspace, ${clock(start)} to ${clock(start + HOUR)}. Undo until ${clock(start)}.`,
    );
    assert.equal(await store.getEvent(boat.id), null);

    const undone = await withClaude(
      [{ tool: { name: "undo_action", input: { recommendation_id: rec.id } } }, { text: "It is back." }],
      () => askMichael(turns("Undo that"), "context"),
    );
    assert.equal(undone.actions[0]?.status, "undone");
    const back = (await store.listEvents({ from: iso(start - HOUR), to: iso(start + 2 * HOUR) })).filter(
      (e) => e.title === "Boatspace",
    );
    assert.equal(back.length, 1, "the block is back");
    assert.equal(Date.parse(back[0]?.start_at ?? ""), start);
    assert.equal(Date.parse(back[0]?.end_at ?? ""), start + HOUR);
    assert.equal(back[0]?.source, "manual", "it comes back as the user's own");
  }));

test("removing an event with other people is refused in one line, and nothing is left behind", () =>
  asNewUser(async () => {
    const start = Date.now() + 5 * HOUR;
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(start),
        end_at: iso(start + HOUR),
        title: "Board meeting",
        data: { with_others: true, attendees: 4 },
      },
    ]);
    const board = inserted[0];
    assert.ok(board);
    const steps: ChatStep[] = [];
    await withClaude(
      [
        { tool: { name: "remove_calendar_block", input: { event_id: board.id } } },
        { text: "That one has other people in it, so I only advise." },
      ],
      async (requests) => {
        const { actions } = await askMichael(turns("Delete the board meeting"), "context", {
          onText: async () => {},
          onStep: async (s) => {
            steps.push(s);
          },
        });
        assert.deepEqual(actions, []);
        const [result] = toolResults(requests[1]);
        assert.equal(result?.is_error, true);
        assert.match(String(result?.content), /conflict.*other people/);
      },
    );
    // Another person's title never reaches the step line.
    assert.equal(steps[0]?.label, "Removing your block");
    assert.ok(await store.getEvent(board.id), "still there");
    assert.deepEqual(await store.listRecommendations({ status: "done" }), []);
  }));

test("a block that has started is not removed", () =>
  asNewUser(async () => {
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(Date.now() - HOUR),
        end_at: iso(Date.now() + HOUR),
        title: "Deep work",
        data: {},
      },
    ]);
    const live = inserted[0];
    assert.ok(live);
    await withClaude(
      [{ tool: { name: "remove_calendar_block", input: { event_id: live.id } } }, { text: "Too late." }],
      async (requests) => {
        const { actions } = await askMichael(turns("delete deep work?"), "context");
        assert.deepEqual(actions, []);
        assert.match(String(toolResults(requests[1])[0]?.content), /already started/);
      },
    );
    assert.ok(await store.getEvent(live.id));
  }));

test("remove_calendar_block only reaches the caller's own blocks", async () => {
  const start = Date.now() + 5 * HOUR;
  const owner = randomUUID();
  const theirs = await runAsUser(owner, async () => {
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(start),
        end_at: iso(start + HOUR),
        title: "Private",
        data: {},
      },
    ]);
    return inserted[0]?.id ?? "";
  });
  await asNewUser(() =>
    withClaude(
      [{ tool: { name: "remove_calendar_block", input: { event_id: theirs } } }, { text: "Not found." }],
      async (requests) => {
        const { actions } = await askMichael(turns("delete it"), "context");
        assert.deepEqual(actions, []);
        assert.match(String(toolResults(requests[1])[0]?.content), /not_found/);
      },
    ),
  );
  await runAsUser(owner, async () =>
    assert.ok(await store.getEvent(theirs), "the owner's block is untouched"),
  );
});

// #457: the rest of what the user can change in the app, by chat and voice.
test("change_calendar_block renames and resizes the user's own block, and undo puts it back", () =>
  asNewUser(async () => {
    const start = Date.now() + 5 * HOUR;
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(start),
        end_at: iso(start + HOUR),
        title: "Boatspace",
        data: {},
      },
    ]);
    const boat = inserted[0];
    assert.ok(boat);
    const steps: ChatStep[] = [];
    const changed = await withClaude(
      [
        {
          tool: {
            name: "change_calendar_block",
            input: { event_id: boat.id, title: "Deep work", end_at: iso(start + 1.5 * HOUR) },
          },
        },
      ],
      () =>
        askMichael(turns("rename Boatspace to Deep work and make it 90 minutes"), "context", {
          onText: async () => {},
          onStep: async (s) => {
            steps.push(s);
          },
        }),
    );
    assert.equal(steps[0]?.label, "Changing Boatspace");
    assert.equal(changed.actions[0]?.status, "done");
    assert.equal(
      changed.answer,
      `Deep work, now ${clock(start)} to ${clock(start + 1.5 * HOUR)}. Undo until ${clock(start)}.`,
    );
    const after = await store.getEvent(boat.id);
    assert.equal(after?.title, "Deep work");
    assert.equal(Date.parse(after?.end_at ?? ""), start + 1.5 * HOUR);

    await withClaude(
      [
        { tool: { name: "undo_action", input: { recommendation_id: changed.actions[0]?.id } } },
        { text: "Back." },
      ],
      () => askMichael(turns("Undo that"), "context"),
    );
    const back = await store.getEvent(boat.id);
    assert.equal(back?.title, "Boatspace");
    assert.equal(Date.parse(back?.end_at ?? ""), start + HOUR);
  }));

test("change_calendar_block refuses an event with other people and leaves no record", () =>
  asNewUser(async () => {
    const start = Date.now() + 5 * HOUR;
    const { inserted } = await store.insertEvents([
      {
        source: "manual",
        type: "calendar_event",
        start_at: iso(start),
        end_at: iso(start + HOUR),
        title: "Board meeting",
        data: { with_others: true, attendees: 4 },
      },
    ]);
    const board = inserted[0];
    assert.ok(board);
    await withClaude(
      [
        { tool: { name: "change_calendar_block", input: { event_id: board.id, title: "Mine now" } } },
        { text: "That one has other people in it." },
      ],
      async (requests) => {
        const { actions } = await askMichael(turns("rename the board meeting"), "context");
        assert.deepEqual(actions, []);
        assert.match(String(toolResults(requests[1])[0]?.content), /conflict.*other people/);
      },
    );
    assert.equal((await store.getEvent(board.id))?.title, "Board meeting");
    assert.deepEqual(await store.listRecommendations({ status: "done" }), []);
  }));

test("change_focus extends and ends the running focus session", () =>
  asNewUser(async () => {
    const goal = await store.createGoal({
      category: "personal",
      title: "University",
      weekly_budget_minutes: 240,
      active: true,
    });
    await withClaude([{ tool: { name: "focus_now", input: { goal_id: goal.id, minutes: 25 } } }], () =>
      askMichael(turns("focus on University for 25 minutes"), "context"),
    );
    const extended = await withClaude(
      [{ tool: { name: "change_focus", input: { action: "extend", minutes: 15 } } }],
      () => askMichael(turns("15 more minutes"), "context"),
    );
    assert.match(extended.answer, /^Focus on University runs until \d\d:\d\d now\.$/);
    const ended = await withClaude(
      [{ tool: { name: "change_focus", input: { action: "end", count: false } } }],
      () => askMichael(turns("stop the focus, it did not count"), "context"),
    );
    assert.equal(ended.answer, "Focus ended. Nothing counted to University.");
    const none = await withClaude(
      [{ tool: { name: "change_focus", input: { action: "end" } } }, { text: "Nothing is running." }],
      async (requests) => {
        await askMichael(turns("end the focus"), "context");
        return toolResults(requests[1])[0];
      },
    );
    assert.equal(none?.is_error, true);
  }));

test("meetings_mode needs the user's consent from the app the first time, then starts and ends", () =>
  asNewUser(async () => {
    const first = await withClaude(
      [{ tool: { name: "meetings_mode", input: { on: true } } }, { text: "Start it once in the app." }],
      async (requests) => {
        await askMichael(turns("start meetings mode"), "context");
        return toolResults(requests[1])[0];
      },
    );
    assert.equal(first?.is_error, true);
    assert.match(String(first?.content), /notice/);
    // The user started it once in the app (consent), and ended it.
    const { startMeeting, endMeeting } = await import("../meetings/meetings");
    await startMeeting(true);
    await endMeeting();
    const on = await withClaude([{ tool: { name: "meetings_mode", input: { on: true } } }], () =>
      askMichael(turns("start meetings mode"), "context"),
    );
    assert.match(on.answer, /^Meetings mode is on until \d\d:\d\d\./);
    const off = await withClaude([{ tool: { name: "meetings_mode", input: { on: false } } }], () =>
      askMichael(turns("end meetings mode"), "context"),
    );
    assert.equal(off.answer, "Meetings mode is off. Nothing more is kept.");
  }));

test("go_off_the_record turns it on; no tool turns it off", () =>
  asNewUser(async () => {
    const r = await withClaude([{ tool: { name: "go_off_the_record", input: {} } }], () =>
      askMichael(turns("go off the record"), "context"),
    );
    assert.match(r.answer, /^You are off the record\./);
    assert.equal((await store.privacyRules()).offTheRecord, true);
    // The switch back is the user's own: no chat tool can turn it off.
    for (const t of CHAT_TOOLS) {
      const props = JSON.stringify(t.input_schema);
      if (t.name === "go_off_the_record")
        assert.equal(props, JSON.stringify({ type: "object", properties: {} }));
      assert.doesNotMatch(props, /off_the_record/, t.name);
    }
  }));

test('"do it" on a Today card: accept_recommendation carries out the offer, and undo takes it back', () =>
  asNewUser(async () => {
    const start = Date.now() + 6 * HOUR;
    const offer = await store.createRecommendation({
      goal_id: null,
      title: "An hour for the pitch",
      rationale: "Your first outcome has no time yet.",
      action: {
        kind: "create_focus_block",
        payload: { start_at: iso(start), end_at: iso(start + HOUR), title: "Pitch" },
        involves_others: false,
        undo_until: iso(start),
      },
      source: "analysis",
    });
    // The offer is in the context with its id, so "yes, book that" can name it.
    const { readChatContextForTests } = await import("./chat");
    assert.match(
      await readChatContextForTests(),
      new RegExp(`An hour for the pitch \\{recommendation_id ${offer.id}\\}`),
    );

    const steps: ChatStep[] = [];
    const done = await withClaude(
      [{ tool: { name: "accept_recommendation", input: { recommendation_id: offer.id } } }],
      () =>
        askMichael(turns("yes, book that"), "context", {
          onText: async () => {},
          onStep: async (s) => {
            steps.push(s);
          },
        }),
    );
    assert.equal(steps[0]?.label, "Doing what I offered");
    assert.equal(done.actions[0]?.status, "done");
    assert.equal(done.answer, `Done: An hour for the pitch. Undo until ${clock(start)}.`);
    const range = { from: iso(start - HOUR), to: iso(start + 2 * HOUR), source: ["agent" as const] };
    assert.equal((await store.listEvents(range)).length, 1);

    await withClaude(
      [{ tool: { name: "undo_action", input: { recommendation_id: offer.id } } }, { text: "Taken back." }],
      () => askMichael(turns("undo"), "context"),
    );
    assert.equal((await store.listEvents(range)).length, 0);
  }));

test("accept_recommendation refuses an offer that involves other people", () =>
  asNewUser(async () => {
    const start = Date.now() + 6 * HOUR;
    const offer = await store.createRecommendation({
      goal_id: null,
      title: "Ask the team to start later",
      rationale: "Advice only.",
      action: {
        kind: "create_focus_block",
        payload: { start_at: iso(start), end_at: iso(start + HOUR), title: "Team" },
        involves_others: true,
        undo_until: iso(start),
      },
      source: "analysis",
    });
    await withClaude(
      [
        { tool: { name: "accept_recommendation", input: { recommendation_id: offer.id } } },
        { text: "That one has other people in it." },
      ],
      async (requests) => {
        const { actions } = await askMichael(turns("do it"), "context");
        assert.deepEqual(actions, []);
        assert.match(String(toolResults(requests[1])[0]?.content), /conflict.*other people/);
      },
    );
    assert.equal((await store.getRecommendation(offer.id))?.status, "proposed");
  }));

// #483: on Loukas' account Michael said he had added a Gym block when no tool had saved it in that
// answer, and read Saturday's lines on Sunday as if said today.

test("#483 a claimed booking with no tool call becomes one honest line and an offer", () =>
  asNewUser(() =>
    withClaude(
      [
        {
          text: "Yes, I can write to your calendar. I've added Gym for Sunday 10:00 to 11:00. Undo until 10:00.",
        },
      ],
      async () => {
        const { answer, actions } = await askMichael(
          turns("Yes do you have access to write as well?"),
          "context",
        );
        assert.deepEqual(actions, []);
        assert.doesNotMatch(answer, /I've added|Undo until/);
        assert.match(
          answer,
          /^Yes, I can write to your calendar\. I haven't added it yet\. Shall I do it now\?$/,
        );
      },
    ),
  ));

test("#483 a tool error the model ignores is said as an error, and the block it tried is offered", () =>
  asNewUser(() => {
    const start = Date.now() - HOUR;
    return withClaude(
      [
        {
          tool: {
            name: "create_focus_block",
            input: { title: "Gym", start_at: iso(start), end_at: iso(start + HOUR) },
          },
        },
        { text: `Added Gym, ${clock(start)} to ${clock(start + HOUR)}. Undo until ${clock(start)}.` },
      ],
      async () => {
        const { answer, actions } = await askMichael(turns("Add gym for the last hour"), "context");
        assert.deepEqual(actions, []);
        assert.equal(answer, "That didn't go through: That time has already started.");
      },
    );
  }));

test("#483 a booking that really happened keeps its words", () =>
  asNewUser(() => {
    const start = Date.now() + 3 * HOUR;
    return withClaude(
      [
        {
          tool: {
            name: "create_focus_block",
            input: { title: "Gym", start_at: iso(start), end_at: iso(start + HOUR) },
          },
        },
        { text: `I've added Gym, ${clock(start)} to ${clock(start + HOUR)}.` },
      ],
      async () => {
        const { answer } = await askMichael(turns("Add gym"), "context");
        assert.equal(
          answer,
          `I've added Gym, ${clock(start)} to ${clock(start + HOUR)}. Undo until ${clock(start)}.`,
        );
      },
    );
  }));

test("#483 an old claim replayed from the thread is not repeated as done; the thread's actions are in the prompt", () =>
  // The account behind the dev key, so POST /v1/chat reads the same thread.
  runAsUser(env.DEMO_USER_ID, async () => {
    await withoutInstructions(store);
    const start = Date.now() + 5 * HOUR;
    // Saturday: Gym booked, then undone from the app.
    const booked = await withClaude(
      [
        {
          tool: {
            name: "create_focus_block",
            input: { title: "Gym", start_at: iso(start), end_at: iso(start + HOUR) },
          },
        },
      ],
      () => askMichael(turns("Add gym"), "context"),
    );
    const rec = booked.actions[0];
    assert.ok(rec);
    const { undoRecommendation } = await import("../actions/calendar");
    await undoRecommendation(rec.id);
    const thread = await store.createChatThread();
    await store.addChatMessage(thread.id, "user", "Yes please");
    await store.addChatMessage(
      thread.id,
      "assistant",
      `I've added Gym, ${clock(start)} to ${clock(start + HOUR)}.`,
      [rec.id],
    );

    await withClaude(
      [
        {
          text: `Hello. It's there now: Gym, ${clock(start)} to ${clock(start + HOUR)}. Undo until ${clock(start)}.`,
        },
      ],
      async (requests) => {
        const res = await app.request("/v1/chat", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ message: "Hello", thread_id: thread.id }),
        });
        assert.equal(res.status, 201);
        const body = ChatResponse.parse(await res.json());
        assert.equal(body.reply.content, "Hello. I haven't added it yet. Shall I do it now?");
        const system = JSON.stringify(requests[0]?.system);
        assert.match(system, /What I did earlier in this conversation, as it stands now:/);
        assert.match(system, /Gym, \d\d:\d\d to \d\d:\d\d \([A-Za-z]+ \d+ [A-Za-z]+\): undone at /);
        assert.match(system, /Now: [A-Za-z]+ \d+ [A-Za-z]+, \d\d:\d\d \(Europe\/Athens\)/);
      },
    );
  }));

test("#483 a block booked but gone from the calendar since reads as removed, never as never added", () =>
  asNewUser(async () => {
    const start = Date.now() + 5 * HOUR;
    const booked = await withClaude(
      [
        {
          tool: {
            name: "create_focus_block",
            input: { title: "Gym", start_at: iso(start), end_at: iso(start + HOUR) },
          },
        },
      ],
      () => askMichael(turns("Add gym"), "context"),
    );
    const rec = booked.actions[0];
    assert.ok(rec);
    const { threadActionLines } = await import("./chat");
    assert.match((await threadActionLines([rec]))[0] ?? "", /: done at .*; undo until \d\d:\d\d$/);
    const [block] = await store.listEvents({
      from: iso(start - 1000),
      to: iso(start + HOUR),
      type: ["calendar_event"],
    });
    assert.ok(block);
    await store.deleteEvents([block.id]);
    assert.match(
      (await threadActionLines([rec]))[0] ?? "",
      /the block is no longer on the calendar \(removed since/,
    );
  }));

test("#483 lines from an earlier day carry their day, so Saturday's tomorrow is not read on Sunday", async () => {
  const { toTurns } = await import("./chat");
  // Sunday 15 November, 12:48 in Athens.
  const now = Date.parse("2026-11-15T12:48:00+02:00");
  const line = (role: "user" | "assistant", content: string, at: string) => ({
    id: randomUUID(),
    role,
    content,
    created_at: at,
    action_ids: [],
  });
  const t = toTurns(
    [
      line("user", "How is my day going?", "2026-11-14T20:17:00+02:00"),
      line("assistant", "Nothing today. Gym tomorrow at 10:00?", "2026-11-14T20:17:01+02:00"),
      line("user", "What time did I open Instagram today", "2026-11-15T12:40:00+02:00"),
    ],
    now,
  );
  assert.equal(t[0]?.content, "[Saturday 14 November, 20:17] How is my day going?");
  // Michael's own lines are left as he wrote them; the user's line before each one dates the pair.
  assert.equal(t[1]?.content, "Nothing today. Gym tomorrow at 10:00?");
  assert.equal(t[2]?.content, "What time did I open Instagram today");
});

test("#483 the cached context reads again after a calendar sync and after midnight in Athens", () =>
  asNewUser(async () => {
    const { contextVersion } = await import("./chat");
    const { currentUserId } = await import("../context");
    const user = currentUserId();
    const before = contextVersion(user, Date.parse("2026-11-14T23:59:00+02:00"));
    // A new day in Athens, with no write: the version moves.
    assert.notEqual(contextVersion(user, Date.parse("2026-11-15T00:01:00+02:00")), before);
    // A calendar sync writes through the store: the version moves too.
    const same = contextVersion(user, Date.parse("2026-11-14T23:59:00+02:00"));
    assert.equal(same, before);
    await store.upsertEvents([
      {
        source: "google_calendar",
        type: "calendar_event",
        start_at: iso(Date.now() + HOUR),
        end_at: iso(Date.now() + 2 * HOUR),
        title: "Boatspace",
        data: {},
        external_id: `g-${randomUUID()}`,
      },
    ]);
    assert.notEqual(contextVersion(user, Date.parse("2026-11-14T23:59:00+02:00")), before);
  }));
