import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { ChatHistory, ChatResponse, ChatThread, ChatThreadDeleted, ChatThreadList } from "@michael/shared";
import { app } from "../app";
import { setChatClientForTests } from "./chat";
import { acceptableTitle, setTitleClientForTests, templateTitle, titleFor } from "./chat-threads";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };

test("threads: a new thread per topic, its own lines, titles across threads, search and real deletion", async () => {
  const systems: string[] = [];
  const fake = {
    messages: {
      create: async (req: { system: { text: string }[] }) => {
        systems.push(req.system.map((s) => s.text).join("\n"));
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Noted. One step at a time." }] };
      },
    },
  } as unknown as Anthropic;
  setChatClientForTests(fake);
  setTitleClientForTests(null);
  const post = async (body: unknown) => {
    const res = await app.request("/v1/chat", { method: "POST", headers: auth, body: JSON.stringify(body) });
    assert.equal(res.status, 201, await res.clone().text());
    return ChatResponse.parse(await res.json());
  };
  try {
    const exams = await post({
      message: "My exams start on Monday, help me plan the week?",
      thread_id: "new",
    });
    // Named from the first line (the template here: no model names threads in this test).
    assert.equal(exams.thread.title, "My exams start on Monday, help");
    assert.equal(exams.thread.preview, "Noted. One step at a time.");
    const gym = await post({ message: "Gym tomorrow morning", thread_id: "new" });
    assert.notEqual(gym.thread.id, exams.thread.id);
    // The second thread hears of the first by its title only, never its lines.
    const system = systems.at(-1) ?? "";
    assert.match(system, /Other conversations \(titles only\):\n- My exams start on Monday, help \(today\)/);
    assert.doesNotMatch(system, /help me plan the week/);

    // No thread_id: the latest thread. A later line keeps the title it has.
    const again = await post({ message: "And on Friday?" });
    assert.equal(again.thread.id, gym.thread.id);
    assert.equal(again.thread.title, "Gym tomorrow morning");

    const history = ChatHistory.parse(
      await (await app.request(`/v1/chat?thread_id=${exams.thread.id}`, { headers: auth })).json(),
    );
    assert.deepEqual(
      history.messages.map((m) => m.content),
      ["My exams start on Monday, help me plan the week?", "Noted. One step at a time."],
    );
    assert.equal(history.thread?.id, exams.thread.id);

    // Rename and pin: pinned first in the list.
    const patch = await app.request(`/v1/chat/threads/${exams.thread.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ title: "Exam week", pinned: true }),
    });
    assert.equal(ChatThread.parse(await patch.json()).title, "Exam week");
    const list = ChatThreadList.parse(
      await (await app.request("/v1/chat/threads", { headers: auth })).json(),
    );
    assert.equal(list.threads[0]?.id, exams.thread.id);
    // Search reads line text too.
    const found = ChatThreadList.parse(
      await (await app.request("/v1/chat/threads?q=friday", { headers: auth })).json(),
    );
    assert.deepEqual(
      found.threads.map((t) => t.id),
      [gym.thread.id],
    );
    // Archived threads leave the list but stay readable.
    await app.request(`/v1/chat/threads/${gym.thread.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ archived: true }),
    });
    const archived = ChatThreadList.parse(
      await (await app.request("/v1/chat/threads?archived=true", { headers: auth })).json(),
    );
    assert.deepEqual(
      archived.threads.map((t) => t.id),
      [gym.thread.id],
    );

    // Delete takes every line with it.
    const del = await app.request(`/v1/chat/threads/${exams.thread.id}`, { method: "DELETE", headers: auth });
    assert.equal(ChatThreadDeleted.parse(await del.json()).messages, 2);
    assert.equal((await app.request(`/v1/chat?thread_id=${exams.thread.id}`, { headers: auth })).status, 404);
    const unknown = await app.request("/v1/chat", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "hello", thread_id: exams.thread.id }),
    });
    assert.equal(unknown.status, 404);
  } finally {
    setChatClientForTests(null);
    setTitleClientForTests(undefined);
  }
});

test("POST /v1/chat/threads makes an empty thread, with or without a body", async () => {
  const bare = await app.request("/v1/chat/threads", { method: "POST", headers: auth });
  assert.equal(bare.status, 201);
  assert.equal(ChatThread.parse(await bare.json()).title, "New chat");
  const named = await app.request("/v1/chat/threads", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ title: "Race week" }),
  });
  const thread = ChatThread.parse(await named.json());
  assert.equal(thread.title, "Race week");
  assert.equal(thread.preview, null);
  const empty = await app.request(`/v1/chat/threads/${thread.id}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({}),
  });
  assert.equal(empty.status, 400);
});

test("thread titles: the model's name when it fits, the first words when it does not", async () => {
  assert.equal(templateTitle("how did i sleep this week?"), "How did i sleep this week");
  assert.equal(acceptableTitle('"Exam week plan."'), "Exam week plan");
  assert.equal(acceptableTitle("Sleep — this week"), null);
  assert.equal(acceptableTitle("one two three four five six seven eight"), null);
  const answer = (text: string) =>
    ({
      messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] }) },
    }) as unknown as Anthropic;
  try {
    setTitleClientForTests(answer("Gym before work"));
    assert.equal(await titleFor("Can I fit the gym in before work tomorrow?"), "Gym before work");
    setTitleClientForTests(answer("A title\nwith two lines"));
    assert.equal(await titleFor("Can I fit the gym in before work?"), "Can I fit the gym in");
  } finally {
    setTitleClientForTests(undefined);
  }
});
