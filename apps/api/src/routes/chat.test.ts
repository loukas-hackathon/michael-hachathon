import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  ApiError,
  ChatHistory,
  type ChatMessage,
  ChatResponse,
  type Event,
  type Goal,
  type Instruction,
  mockGoals,
  mockInstructions,
  mockScore,
} from "@michael/shared";
import { app } from "../app";
import { buildChatContext, CONNECT_LINE, scoreLines, setChatClientForTests, toTurns } from "./chat";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };

const event = (type: Event["type"], title: string, start: string, end: string | null): Event => ({
  id: crypto.randomUUID(),
  source: "manual",
  type,
  start_at: start,
  end_at: end,
  title,
  data: {},
  external_id: null,
  created_at: start,
});

test("chat context lists goals, today's entries and weekly totals in local time", () => {
  const text = buildChatContext({
    now: Date.parse("2026-11-14T19:05:00+02:00"),
    goals: mockGoals,
    events: [
      event("sleep", "Sleep", "2026-11-13T23:40:00+02:00", "2026-11-14T07:10:00+02:00"),
      event("workout", "Run", "2026-11-14T08:00:00+02:00", "2026-11-14T08:45:00+02:00"),
      event("calendar_event", "Gym block", "2026-11-14T20:00:00+02:00", "2026-11-14T21:00:00+02:00"),
      event("workout", "Swim", "2026-11-12T07:00:00+02:00", "2026-11-12T08:00:00+02:00"),
    ],
    today: null,
    week: null,
  });
  assert.match(text, /Saturday 14 November, 19:05/);
  assert.match(text, /4h of deep work per day \[business, 20h a week planned\]/);
  assert.match(text, /- 08:00 to 08:45 workout: Run/);
  assert.match(text, /- 20:00 to 21:00 calendar event: Gym block \(planned\)/);
  assert.match(text, /- 23:40 to 07:10 sleep: Sleep/);
  // The swim was on Thursday: not a line of today, but in the weekly total.
  assert.doesNotMatch(text, /workout: Swim/);
  assert.match(text, /- workout: 2 entries, 105 minutes in total/);
});

test("chat context reads older categories as the three, and carries the active standing instructions", () => {
  const goal = (category: Goal["category"], title: string): Goal => ({
    ...(mockGoals[0] as Goal),
    category,
    title,
    description: null,
    weekly_budget_minutes: null,
  });
  const rule = (text: string, active: boolean): Instruction => ({
    ...(mockInstructions[0] as Instruction),
    text,
    active,
  });
  const input = {
    now: Date.parse("2026-11-14T19:05:00+02:00"),
    goals: [goal("work", "The company"), goal("gym", "70.3"), goal("personal", "Fun")],
    events: [],
    today: null,
    week: null,
  };
  const text = buildChatContext({
    ...input,
    instructions: [rule("Keep Sundays clear", true), rule("No calls on Fridays", false)],
  });
  assert.match(text, /- The company \[business\] [^\n]*\n- 70\.3 \[health\] [^\n]*\n- Fun \[personal\] /);
  // The mock rule carries its exception, in words.
  assert.match(
    text,
    /Standing instructions \(never plan, move or suggest[^\n]*\):\n- Keep Sundays clear \(except: Rhefuel\) \{instruction_id [0-9a-f-]+\}\n/,
  );
  // A paused instruction is not handed over; with none, the section is not there at all.
  assert.doesNotMatch(text, /No calls on Fridays/);
  assert.doesNotMatch(buildChatContext(input), /Standing instructions/);
});

test("chat history always starts with the user's turn", () => {
  const line = (role: ChatMessage["role"], content: string): ChatMessage => ({
    id: crypto.randomUUID(),
    role,
    content,
    created_at: "2026-11-14T19:00:00+02:00",
    action_ids: [],
  });
  assert.deepEqual(toTurns([line("assistant", "a"), line("user", "b"), line("assistant", "c")]), [
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
  ]);
  assert.deepEqual(toTurns([line("assistant", "a")]), []);
});

test("GET /v1/chat returns the history", async () => {
  const res = await app.request("/v1/chat", { headers: auth });
  assert.equal(res.status, 200);
  ChatHistory.parse(await res.json());
});

test("POST /v1/chat validates the body", async () => {
  const res = await app.request("/v1/chat", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ message: " " }),
  });
  assert.equal(res.status, 400);
});

test("POST /v1/chat without a model key answers 503 and stores nothing", {
  skip: !!process.env.ANTHROPIC_API_KEY,
}, async () => {
  const res = await app.request("/v1/chat", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ message: "How is my day going?" }),
  });
  assert.equal(res.status, 503);
  assert.equal(ApiError.parse(await res.json()).error.code, "unavailable");
  const history = ChatHistory.parse(await (await app.request("/v1/chat", { headers: auth })).json());
  assert.equal(history.messages.length, 0);
});

test("POST /v1/chat/stream without a model key answers 503 before streaming", {
  skip: !!process.env.ANTHROPIC_API_KEY,
}, async () => {
  const res = await app.request("/v1/chat/stream", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ message: "How is my day going?" }),
  });
  assert.equal(res.status, 503);
  assert.equal(ApiError.parse(await res.json()).error.code, "unavailable");
});

test("the score goes into the chat context with its own figures", () => {
  const text = scoreLines(mockScore);
  assert.match(text, /64% of planned goal time spent/);
  assert.match(text, /6h 56 spent of 10h 50 planned time already passed/);
  assert.match(
    text,
    /4h of deep work per day \[business\]: 6h 06 spent of budget 20h \(13h 54 left to reach it\)/,
  );
  // A goal's score is its planned time kept, named so the model never quotes it as a share of the
  // budget (production: "University at 42% (2h 01 of 6h)").
  assert.match(text, /\d+% of its planned time already passed was spent \(not a share of the budget\)/);
});

test("POST /v1/chat/stream sends deltas, then the stored reply", async () => {
  const pieces = ["Two hours ", "of focus ", "left today."];
  const fake = {
    messages: {
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          for (const text of pieces) {
            yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
          }
        },
        finalMessage: async () => ({
          stop_reason: "end_turn",
          content: [{ type: "text", text: pieces.join("") }],
        }),
      }),
    },
  } as unknown as Anthropic;
  setChatClientForTests(fake);
  try {
    const res = await app.request("/v1/chat/stream", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "What is left today?" }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const events = (await res.text())
      .trim()
      .split("\n\n")
      .map((block) => ({
        event: /^event: (.*)$/m.exec(block)?.[1],
        data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null"),
      }));
    assert.deepEqual(
      events.filter((e) => e.event === "delta").map((e) => e.data.text),
      pieces,
    );
    const done = events.at(-1);
    assert.equal(done?.event, "done");
    assert.equal(ChatResponse.parse(done?.data).reply.content, "Two hours of focus left today.");
    // Stored for this user: the history now ends with the pair.
    const history = ChatHistory.parse(await (await app.request("/v1/chat", { headers: auth })).json());
    assert.deepEqual(
      history.messages.slice(-2).map((m) => m.content),
      ["What is left today?", "Two hours of focus left today."],
    );
  } finally {
    setChatClientForTests(null);
  }
});

test("Michael points to the Connect button for every live connection (#307)", () => {
  assert.match(
    CONNECT_LINE,
    /connect their calendar, Claude, Telegram, nudges, their Apple Watch, their Mac, their iPhone apps or their location, the app shows/,
  );
  assert.doesNotMatch(CONNECT_LINE, /coming soon/);
  assert.match(CONNECT_LINE, /Never give steps, links or keys\./);
});
