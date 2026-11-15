import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DEFAULT_PROFILE, type Knowledge } from "@michael/shared";
import { Hono } from "hono";
import { runChatTool } from "./actions/chat-tools";
import { v1Routes } from "./app";
import { type AuthMethod, runAsUser } from "./context";
import { errorResponse, HttpError } from "./http";
import { daysPhrase, knowledgeFor, knowledgeText, NEVER_KEPT, profileItems } from "./knowledge";
import { remember } from "./memory";
import { store } from "./store";

// "What I know about you" (#379): every item comes from a store that already holds it, scoped
// to the caller, and each one the page offers to forget is really gone through its own route.

const sessions = new Hono()
  .use(async (c, next) => runAsUser(c.req.header("x-test-user") as string, next, "session" as AuthMethod))
  .route("/v1", v1Routes)
  .onError((err, c) =>
    err instanceof HttpError
      ? errorResponse(c, err.code, err.message)
      : errorResponse(c, "internal", String(err)),
  );
const call = (user: string, method: string, path: string, body?: unknown) =>
  sessions.request(path, {
    method,
    headers: { "x-test-user": user, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const knowledgeOf = async (user: string): Promise<Knowledge> => {
  const res = await call(user, "GET", "/v1/me/knowledge");
  assert.equal(res.status, 200);
  return (await res.json()) as Knowledge;
};

const A = randomUUID();
const B = randomUUID();
const MARK = `knows-${A.slice(0, 8)}`;
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());

test("knowledge: what A told Michael shows up in plain words, grouped, with where it came from", async () => {
  const memory = await runAsUser(A, () => remember(`${MARK} trains before 08:00`, "chat"), "session");
  assert.ok(memory);
  await runAsUser(
    A,
    async () => {
      const [q] = await store.createCheckIns([
        {
          key: `test:${MARK}`,
          day,
          kind: "short_night",
          question: "You slept 5h 10. Energy today? 1 to 5.",
          answer_type: "scale",
          moment: "evening",
          event_id: null,
          goal_id: null,
          start_at: null,
          end_at: null,
          follow_up_of: null,
        },
        {
          key: `test:${MARK}:open`,
          day,
          kind: "training",
          question: "Unanswered question",
          answer_type: "scale",
          moment: "evening",
          event_id: null,
          goal_id: null,
          start_at: null,
          end_at: null,
          follow_up_of: null,
        },
      ]);
      await store.answerCheckIn(q?.id as string, { answer: 2, label: "low" });
    },
    "session",
  );
  assert.equal(
    (await call(A, "POST", "/v1/instructions", { text: `${MARK} keep Sundays clear` })).status,
    201,
  );
  assert.equal(
    (
      await call(A, "PUT", "/v1/profile", {
        weak_spots: ["late_nights"],
        quiet_hours: { start: "23:00", end: "07:00" },
      })
    ).status,
    200,
  );
  await runAsUser(
    A,
    () =>
      store.insertEvents([
        {
          source: "chrome",
          type: "web_visit",
          start_at: new Date(Date.now() - 600_000).toISOString(),
          end_at: null,
          title: "example.com",
          data: {},
          external_id: null,
        },
      ]),
    "session",
  );

  const k = await knowledgeOf(A);
  const mem = k.told.find((i) => i.kind === "memory");
  assert.equal(mem?.text, `${MARK} trains before 08:00`);
  assert.equal(mem?.origin, "chat");
  assert.equal(mem?.forgettable, true);
  const checkIns = k.told.filter((i) => i.kind === "check_in");
  assert.equal(checkIns.length, 1, "only answered questions");
  assert.equal(checkIns[0]?.answer, "2");
  assert.ok(k.told.some((i) => i.kind === "instruction" && i.text.includes(MARK) && i.origin === "you"));
  assert.ok(
    k.told.some((i) => i.id === "quiet_hours" && i.text.includes("23:00 to 07:00") && !i.forgettable),
  );
  assert.ok(k.told.some((i) => i.id === "weak_spots:late_nights" && i.forgettable));
  assert.deepEqual(
    [...new Set(k.told.map((i) => i.kind))],
    ["memory", "check_in", "instruction", "profile"],
    "grouped in order",
  );
  const chrome = k.reads.find((r) => r.source === "chrome");
  assert.equal(chrome?.name, "Chrome");
  assert.equal(chrome?.collecting, true);
  assert.ok(chrome?.last_event_at);
  assert.ok(!k.reads.some((r) => r.source === "manual" || r.source === "agent"), "not connections");
  assert.deepEqual(k.never_kept, [...NEVER_KEPT]);
  assert.equal(k.never_kept.length, 3);
});

test("knowledge: B sees none of A's, through the route, the chat tool or the plain text", async () => {
  const k = await knowledgeOf(B);
  assert.ok(!JSON.stringify(k).includes(MARK));
  assert.ok(!k.told.some((i) => i.kind === "memory" || i.kind === "check_in"), "B told Michael nothing");
  const tool = await runAsUser(B, () => runChatTool("what_you_know", {}), "session");
  assert.equal(tool.isError, false);
  assert.ok(!tool.content.includes(MARK));
  assert.doesNotMatch(tool.content, /Things you told me to remember/);
});

test("knowledge: forget really deletes, only through the owner's routes", async () => {
  const before = await knowledgeOf(A);
  const mem = before.told.find((i) => i.kind === "memory");
  const check = before.told.find((i) => i.kind === "check_in");
  const rule = before.told.find((i) => i.kind === "instruction");
  assert.ok(mem && check && rule);
  // B cannot forget A's items.
  assert.equal((await call(B, "DELETE", `/v1/events/${mem.id}`)).status, 404);
  assert.equal((await call(B, "DELETE", `/v1/check-in/${check.id}`)).status, 404);
  assert.equal((await call(B, "DELETE", `/v1/instructions/${rule.id}`)).status, 404);
  assert.equal((await knowledgeOf(A)).told.length, before.told.length);
  // A can, and they are gone.
  assert.ok((await call(A, "DELETE", `/v1/events/${mem.id}`)).status < 300);
  assert.ok((await call(A, "DELETE", `/v1/check-in/${check.id}`)).status < 300);
  assert.ok((await call(A, "DELETE", `/v1/instructions/${rule.id}`)).status < 300);
  const after = await knowledgeOf(A);
  assert.ok(!after.told.some((i) => [mem.id, check.id, rule.id].includes(i.id)));
  assert.equal(await runAsUser(A, () => store.getEvent(mem.id), "session"), null, "the row is gone");
});

test("knowledge: plain text names each group and the memory ids", async () => {
  const text = await runAsUser(
    randomUUID(),
    async () => {
      await remember("Fridays are for family", "agent");
      return knowledgeText(await knowledgeFor());
    },
    "session",
  );
  assert.match(text, /Things you told me to remember:\n- Fridays are for family \{memory_id /);
  assert.match(text, /What I read: /);
  assert.match(text, /What I never keep: Your voice\./);
});

test("knowledge: profile lines only once the user saved it, days in words", () => {
  assert.deepEqual(profileItems(DEFAULT_PROFILE), []);
  const items = profileItems({
    ...DEFAULT_PROFILE,
    gym_days: ["mon", "wed", "fri"],
    fixed_titles: ["PT session"],
    updated_at: new Date().toISOString(),
  });
  assert.deepEqual(
    items.map((i) => i.text),
    [
      "Quiet hours 22:00 to 07:00",
      "Work Mon to Fri, 09:00 to 18:00",
      "Training Mon, Wed and Fri",
      'Never move "PT session"',
    ],
  );
  assert.equal(daysPhrase(["sun", "sat", "mon", "tue", "wed", "thu", "fri"]), "every day");
  assert.equal(daysPhrase(["sat"]), "Sat");
});
