import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  Draft,
  DraftGenerateResult,
  type Event,
  type EventInput,
  mockRecommendations,
} from "@michael/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { z } from "zod";
import { FakeModelClient, ModelError, useModelClient } from "../analysis/model";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { createMcpServer } from "../mcp";
import { MemoryStore, store } from "../store";
import { executeRecommendation, undoRecommendation } from "./calendar";
import { runChatTool } from "./chat-tools";
import { candidates, DRAFT_INSTRUCTIONS, generateDrafts, seedDemoDrafts, templateDraft } from "./drafts";

// Follow up drafts (#40): Claude is always a scripted fake here; nothing is ever sent anywhere.

const HOUR = 3600_000;
const NOW = Date.parse("2026-11-14T18:00:00+02:00");
const iso = (ms: number) => new Date(ms).toISOString();
const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const asNewUser = <T>(fn: () => Promise<T>) => runAsUser(randomUUID(), fn);
const asDemo = <T>(fn: () => Promise<T>) => runAsUser(env.DEMO_USER_ID, fn);

type Input = z.output<typeof EventInput>;
const customerCall = (end = NOW - HOUR): Input => ({
  source: "omi",
  type: "conversation",
  start_at: iso(end - 40 * 60_000),
  end_at: iso(end),
  title: "Customer call: onboarding feedback",
  data: {
    summary: "The pilot team likes the weekly view but finds setup too long.",
    action_items: ["Write up the onboarding steps they skipped", "Follow up with pricing by Monday"],
  },
  external_id: `omi:${randomUUID()}`,
});
const meeting = (title: string, attendees: number, startMs: number, mins = 30): Input => ({
  source: "google_calendar",
  type: "calendar_event",
  start_at: iso(startMs),
  end_at: iso(startMs + mins * 60_000),
  title,
  data: { attendees, status: "confirmed", all_day: false },
  external_id: `g:${randomUUID()}`,
});
const asEvent = (i: Input): Event => ({
  ...i,
  id: randomUUID(),
  end_at: i.end_at ?? null,
  external_id: i.external_id ?? null,
  created_at: iso(NOW),
});

const MODEL_DRAFT = JSON.stringify({
  channel: "email",
  subject: "Onboarding — next steps",
  body: "Hi,\n\nThanks for the call today — really useful. I will send the onboarding write up and pricing by Monday. 🚀\n\nBest,",
});

async function add(...inputs: Input[]) {
  const { inserted } = await store.insertEvents(inputs);
  return inserted;
}

test("only finished conversations and small meetings with others are followed up", () => {
  const talk = asEvent(customerCall());
  const overlapped = asEvent(meeting("Customer call", 3, Date.parse(talk.start_at) - 2 * 60_000, 45));
  const investor = asEvent(meeting("Investor intro call", 2, NOW - 3 * HOUR));
  const lecture = asEvent(meeting("Lecture: Pricing Strategy", 40, NOW - 4 * HOUR));
  const solo = asEvent(meeting("Gym", 0, NOW - 5 * HOUR));
  const later = asEvent(meeting("Mentor check in", 2, NOW + HOUR));
  const empty = asEvent({ ...customerCall(NOW - 6 * HOUR), data: {} });
  const picked = candidates([solo, lecture, investor, overlapped, talk, later, empty], NOW);
  assert.deepEqual(
    picked.map((e) => e.title),
    ["Customer call: onboarding feedback", "Investor intro call"],
  );
});

test("the template speaks to the other people and keeps the user's commitments", () => {
  const d = templateDraft(asEvent(customerCall(NOW - 26 * HOUR)), NOW);
  assert.equal(d.channel, "email");
  assert.equal(d.subject, "Following up: Customer call");
  assert.match(d.body, /^Hi,\n\nThanks for your time yesterday\./);
  assert.match(d.body, /1\. Write up the onboarding steps you skipped\n2\. Follow up with pricing by Monday/);
  assert.doesNotMatch(d.body, /[–—]| - /);

  const sync = templateDraft(asEvent({ ...meeting("Weekly sync", 3, NOW - 2 * HOUR) }), NOW);
  assert.equal(sync.channel, "chat");
  assert.equal(sync.subject, null);
  assert.equal(sync.body, "Thanks for the weekly sync today. Shout if I missed anything.");
});

test("Claude drafts from the summary only, the copy is tidied, and an event is drafted once", () =>
  asNewUser(async () => {
    const fake = new FakeModelClient([MODEL_DRAFT]);
    useModelClient(fake);
    try {
      const [talk] = await add(customerCall(Date.now() - HOUR));
      // The mock day carries a conversation of its own, so look for ours.
      const first = DraftGenerateResult.parse(await generateDrafts());
      const d = first.drafts.find((x) => x.event_id === talk?.id) as Draft;
      assert.ok(d, "the customer call is drafted");
      assert.equal(d.written_by, "model");
      assert.equal(d.status, "proposed");
      assert.equal(d.subject, "Onboarding, next steps");
      assert.doesNotMatch(d.body, /[–—]|🚀/u);
      assert.match(d.body, /Thanks for the call today, really useful\./);

      const req = fake.requests.find((r) => r.user.includes("Customer call"));
      assert.equal(req?.system, DRAFT_INSTRUCTIONS);
      assert.match(req?.user ?? "", /Summary: The pilot team likes the weekly view/);
      assert.match(req?.user ?? "", /\* Follow up with pricing by Monday/);

      const calls = fake.requests.length;
      const again = await generateDrafts();
      assert.equal(again.drafts.length, 0);
      assert.equal(again.skipped, first.drafts.length);
      assert.equal(fake.requests.length, calls, "no second model call for a drafted event");
      assert.equal((await store.listDrafts()).length, first.drafts.length);
    } finally {
      useModelClient(null);
    }
  }));

test("a failing model falls back to the template, never to nothing", () =>
  asNewUser(async () => {
    useModelClient(new FakeModelClient([new ModelError("api", "the model API timed out")]));
    try {
      const [talk] = await add(customerCall(Date.now() - HOUR));
      const { drafts } = await generateDrafts({ eventId: talk?.id });
      assert.equal(drafts[0]?.written_by, "template");
      assert.match(drafts[0]?.body ?? "", /Follow up with pricing by Monday/);
    } finally {
      useModelClient(null);
    }
  }));

test("REST: generate, list, mark done or dismissed; nothing is ever sent", () =>
  asDemo(async () => {
    useModelClient(new FakeModelClient([MODEL_DRAFT]));
    try {
      const [talk] = await add(customerCall(Date.now() - HOUR));
      const [future] = await add(meeting("Mentor check in", 2, Date.now() + HOUR));

      const missing = await app.request("/v1/drafts/generate", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ event_id: randomUUID() }),
      });
      assert.equal(missing.status, 404);
      const early = await app.request("/v1/drafts/generate", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ event_id: future?.id }),
      });
      assert.equal(early.status, 409);

      const made = await app.request("/v1/drafts/generate", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ event_id: talk?.id }),
      });
      assert.equal(made.status, 201);
      const draft = DraftGenerateResult.parse(await made.json()).drafts[0] as Draft;

      const list = await app.request("/v1/drafts?status=proposed", { headers: auth });
      const ids = (await list.json()).drafts.map((d: Draft) => d.id);
      assert.ok(ids.includes(draft.id));

      const done = await app.request(`/v1/drafts/${draft.id}`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify({ status: "done" }),
      });
      assert.equal(Draft.parse(await done.json()).status, "done");
      const bad = await app.request(`/v1/drafts/${draft.id}`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify({ status: "sent" }),
      });
      assert.equal(bad.status, 400);
      const gone = await app.request(`/v1/drafts/${randomUUID()}`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify({ status: "dismissed" }),
      });
      assert.equal(gone.status, 404);
    } finally {
      useModelClient(null);
    }
  }));

test("a draft_follow_up recommendation, once carried out, is a stored draft and nothing else", () =>
  asNewUser(async () => {
    const id = mockRecommendations[2]?.id as string;
    const rec = await store.getRecommendation(id);
    assert.ok(rec);
    rec.status = "proposed";
    rec.action = {
      kind: "draft_follow_up",
      payload: { text: "Can we move Thursday to 16:00?" },
      involves_others: false,
      undo_until: null,
    };
    const done = await executeRecommendation(id);
    assert.equal(done.status, "done");
    const [draft] = await store.listDrafts();
    assert.equal(draft?.recommendation_id, id);
    assert.equal(draft?.body, "Can we move Thursday to 16:00?");
    assert.equal(draft?.written_by, "analysis");
    await assert.rejects(undoRecommendation(id), /Dismiss it under Follow ups/);
  }));

test("MCP and chat tools draft and list follow ups", () =>
  asNewUser(async () => {
    useModelClient(new FakeModelClient([new ModelError("api", "offline")]));
    try {
      await add(customerCall(Date.now() - HOUR));
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await createMcpServer().connect(serverSide);
      const client = new Client({ name: "test", version: "0" });
      await client.connect(clientSide);
      type R = { isError?: boolean; content: { text: string }[] };
      const text = (r: R) => r.content.map((c) => c.text).join("\n");

      const drafted = (await client.callTool({ name: "draft_follow_up", arguments: {} })) as R;
      assert.notEqual(drafted.isError, true, text(drafted));
      assert.match(text(drafted), /Nothing was sent/);
      assert.match(text(drafted), /Subject: Following up: Customer call/);
      const listed = (await client.callTool({ name: "list_drafts", arguments: {} })) as R;
      assert.match(text(listed), /\d follow up drafts:/);

      const chat = await runChatTool("draft_follow_up", {});
      assert.equal(chat.isError, false);
      assert.match(chat.content, /already have drafts/);
    } finally {
      useModelClient(null);
    }
  }));

test("the demo week shows its two latest conversations as drafts, once", async () => {
  const db = new MemoryStore();
  await runAsUser(randomUUID(), async () => {
    await db.insertEvents([
      customerCall(NOW - 50 * HOUR),
      { ...customerCall(NOW - 4 * HOUR), title: "Hackathon planning: scope" },
      customerCall(NOW - 120 * HOUR),
      meeting("Mentor check in", 2, NOW - HOUR),
    ]);
    assert.equal(await seedDemoDrafts(db, NOW, 7), 2);
    assert.equal(await seedDemoDrafts(db, NOW, 7), 0);
    const drafts = await db.listDrafts();
    assert.deepEqual(
      drafts.map((d) => d.written_by),
      ["template", "template"],
    );
    assert.ok(drafts.some((d) => d.title === "Hackathon planning: scope"));
  });
});
