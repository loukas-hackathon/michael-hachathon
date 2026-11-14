import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { ChatResponse, Recommendation } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { store } from "../store";
import { askMichael, setChatClientForTests } from "./chat";

const HOUR = 3600_000;
const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const iso = (ms: number) => new Date(ms).toISOString();
const clock = (ms: number) => new Zone(DEFAULT_TIMEZONE).clock(ms);
const asNewUser = <T>(fn: () => Promise<T>) => runAsUser(randomUUID(), fn);

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
    },
  );
});
