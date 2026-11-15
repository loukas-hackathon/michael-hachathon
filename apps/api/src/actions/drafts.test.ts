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
import { MemoryStore, type Store, store } from "../store";
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

// Conversations are kept only inside meetings mode (#400): a session opens around each one first.
async function inMeetings(db: Store, inputs: Input[]) {
  for (const i of inputs) {
    if (i.type !== "conversation") continue;
    const end = i.end_at ?? iso(Date.parse(i.start_at) + HOUR);
    await db.createMeetingSession({ started_at: i.start_at, ends_at: end });
  }
  return db.insertEvents(inputs);
}

async function add(...inputs: Input[]) {
  const { inserted } = await inMeetings(store, inputs);
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
  // A greeting that stands without a name, then thanks, then the commitments turned to "you".
  assert.match(d.body, /^Hello,\n\nThanks for your time yesterday\.\n\nNext from me:\n/);
  assert.match(d.body, /1\. Write up the onboarding steps you skipped\n2\. Follow up with pricing by Monday/);
  assert.doesNotMatch(d.body, /[–—]| - /);

  const sync = templateDraft(asEvent({ ...meeting("Weekly sync", 3, NOW - 2 * HOUR) }), NOW);
  assert.equal(sync.channel, "chat");
  assert.equal(sync.subject, null);
  assert.equal(sync.body, "Thanks for the weekly sync today. Shout if I missed anything.");
});

test('an email never speaks about its readers: no summary in the third person, every line to "you"', () => {
  // The demo week's customer call (demo/week.ts). The summary is Omi's, written about the customer.
  const call = asEvent({
    ...customerCall(NOW - 50 * HOUR),
    data: {
      summary:
        "The pilot team likes the weekly view but finds setup too long. They would pay for a one tap calendar connect.",
      action_items: [
        "Send them the pricing for 20 seats by Tuesday",
        "Set up the one tap calendar connect for their team",
      ],
    },
  });
  const d = templateDraft(call, NOW);
  assert.equal(d.channel, "email");
  assert.equal(
    d.body,
    [
      "Hello,",
      "Thanks for your time on Thursday.",
      "Next from me:\n1. Send you the pricing for 20 seats by Tuesday\n2. Set up the one tap calendar connect for your team",
      "Best,",
    ].join("\n\n"),
  );
  assert.doesNotMatch(d.body, /\b(they|them|their|the pilot team)\b/i);
  assert.doesNotMatch(d.body, /[–—!]| - /);

  // With nothing promised, the email still reads to its reader.
  const bare = templateDraft(asEvent({ ...call, data: { summary: call.data?.summary } }), NOW);
  assert.equal(
    bare.body,
    "Hello,\n\nThanks for your time on Thursday.\n\nTell me if anything is still open on your side.\n\nBest,",
  );

  // A note to the user's own team may quote what was agreed.
  const team = templateDraft(
    asEvent({
      ...customerCall(NOW - 26 * HOUR),
      title: "Hackathon planning: scope for the demo",
      data: {
        summary: "One timeline from every source, the Claude connector as the headline moment.",
        action_items: ["Send them the pitch outline tonight", "Book the rehearsal for Sunday 18:00"],
      },
    }),
    NOW,
  );
  assert.equal(
    team.body,
    "Thanks for the hackathon planning yesterday. Quick recap from my side: one timeline from every source, the Claude connector as the headline moment. Next from me: I will send you the pitch outline tonight and book the rehearsal for Sunday 18:00.",
  );
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
    await inMeetings(db, [
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

test("a reseed that replaces a conversation rewrites its waiting draft; sent and dismissed drafts stay", async () => {
  const db = new MemoryStore();
  await runAsUser(randomUUID(), async () => {
    // A new account starts with the sample day: clear it, so only these conversations are drafted.
    const all = { from: "2026-01-01T00:00:00Z", to: "2027-01-01T00:00:00Z" };
    await db.deleteEvents((await db.listEvents(all)).map((e) => e.id));
    const old = { ...customerCall(NOW - 4 * HOUR), title: "Hackathon planning: scope" };
    old.data = { ...old.data, action_items: ["Seed a realistic demo week"] };
    const { inserted } = await inMeetings(db, [old, customerCall(NOW - 50 * HOUR)]);
    const [oldPlanning, call] = inserted;
    assert.equal(await seedDemoDrafts(db, NOW, 7), 2);
    const before = await db.listDrafts();
    assert.ok(before.some((d) => /seed a realistic demo week/.test(d.body)));
    // The presenter sent the customer email: that draft is history and is never touched.
    const sent = before.find((d) => d.event_id === call?.id) as Draft;
    await db.updateDraftStatus(sent.id, "done");

    // The reseed: the conversation's words changed, so its row is replaced (a new id).
    await db.deleteEvents([oldPlanning?.id as string, call?.id as string]);
    await inMeetings(db, [
      {
        ...old,
        data: { ...old.data, action_items: ["Send them the pitch outline tonight"] },
        external_id: "omi:new",
      },
    ]);
    assert.equal(await seedDemoDrafts(db, NOW, 7), 1);
    const after = await db.listDrafts();
    assert.ok(!after.some((d) => /seed a realistic demo week/.test(d.body)), "the old words are gone");
    assert.ok(
      after.some((d) => d.status === "proposed" && /send you the pitch outline tonight/.test(d.body)),
    );
    assert.ok(
      after.some((d) => d.id === sent.id && d.status === "done"),
      "the sent draft stays",
    );
    assert.equal(await seedDemoDrafts(db, NOW, 7), 0);
  });
});
