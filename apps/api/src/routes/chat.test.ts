import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, ChatHistory, type ChatMessage, type Event, mockGoals } from "@michael/shared";
import { app } from "../app";
import { buildChatContext, toTurns } from "./chat";

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
  assert.match(text, /4h of deep work per day \[work, 20h a week planned\]/);
  assert.match(text, /- 08:00 to 08:45 workout: Run/);
  assert.match(text, /- 20:00 to 21:00 calendar event: Gym block \(planned\)/);
  assert.match(text, /- 23:40 to 07:10 sleep: Sleep/);
  // The swim was on Thursday: not a line of today, but in the weekly total.
  assert.doesNotMatch(text, /workout: Swim/);
  assert.match(text, /- workout: 2 entries, 1h 45m in total/);
});

test("chat history always starts with the user's turn", () => {
  const line = (role: ChatMessage["role"], content: string): ChatMessage => ({
    id: crypto.randomUUID(),
    role,
    content,
    created_at: "2026-11-14T19:00:00+02:00",
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
