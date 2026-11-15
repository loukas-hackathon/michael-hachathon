import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { streamChat } from "../app/chat/stream-chat";

// Venue wifi (finals QA): the network going away must end a send as one line in Michael's words,
// never as an uncaught "Failed to fetch".

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("no network: the fetch rejecting is the offline line, not a thrown error", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const res = await streamChat("When am I free?", null, () => {});
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "offline");
  assert.equal(res.error, "I could not reach the server. Your message is still here to send again.");
});

test("the line drops mid answer: reading the body throwing is a failure, not a page error", async () => {
  const pieces: string[] = [];
  globalThis.fetch = async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"You have"}\n\n'));
          return;
        }
        controller.error(new TypeError("network error"));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const res = await streamChat("When am I free?", null, (t) => pieces.push(t));
  assert.deepEqual(pieces, ["You have"]);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "network");
  assert.equal(res.error, "I lost the line. Try again.");
});

test("a half written event is skipped, the answer still lands", async () => {
  const now = new Date().toISOString();
  const done = {
    message: { id: "m", role: "user", content: "q", created_at: now },
    reply: { id: "r", role: "assistant", content: "Free at 15:00.", created_at: now },
    actions: [],
  };
  globalThis.fetch = async () =>
    new Response(`event: delta\ndata: {"text":\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const res = await streamChat("When am I free?", null, () => {});
  assert.equal(res.ok, true);
});
