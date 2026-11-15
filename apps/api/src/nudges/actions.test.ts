import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type Nudge, NudgeActResult, nudgeUrl, type OutgoingNudge } from "@michael/shared";
import { generateVAPIDKeys } from "web-push";
import { app } from "../app";
import { runAsUser } from "../context";
import { withoutInstructions } from "../instructions/testkit";
import { store } from "../store";
import { actionsFor, actOnNudge, configureSnooze, driftApp, offeredActions, refreshText } from "./actions";
import { nudgePayload } from "./channels";
import { configurePush, type PushPayload, type PushSender } from "./push";
import { callbackData, configureTelegram, nudgeKeyboard, parseCallbackData } from "./telegram";
import { ACTION_TOKEN_TTL_MS, signActionToken, verifyActionToken } from "./token";

const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const asNewUser = <T>(fn: (userId: string) => Promise<T>) => {
  const userId = randomUUID();
  return runAsUser(userId, async () => {
    await withoutInstructions(store);
    return fn(userId);
  });
};

async function nudge(
  over: Partial<Pick<Nudge, "kind" | "key" | "text" | "recommendation_id">> = {},
): Promise<OutgoingNudge> {
  const n = await store.createNudge({
    recommendation_id: over.recommendation_id ?? null,
    goal_id: null,
    kind: over.kind ?? "block_soon",
    key: over.key ?? `block_soon:evt-${randomUUID().slice(0, 6)}`,
    day: "2026-11-15",
    channel: "push",
    text: over.text ?? "Gym at 18:00. Wrap up in 12 min.",
    reason: "test",
    status: "sent",
  });
  assert.ok(n);
  return { ...n, actions: offeredActions(n) };
}

const act = (id: string, body: unknown) =>
  app.request(`/v1/nudges/${id}/act`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("action token: signed for one nudge and one user, and it expires", () => {
  const now = Date.parse("2026-11-15T10:00:00Z");
  const nudgeId = randomUUID();
  const userId = randomUUID();
  const token = signActionToken(nudgeId, userId, now);
  assert.deepEqual(verifyActionToken(token, nudgeId, now), { ok: true, userId });
  assert.deepEqual(verifyActionToken(token, nudgeId, now + ACTION_TOKEN_TTL_MS + 1000), {
    ok: false,
    reason: "expired",
  });
  // Another nudge, a swapped user, a touched signature, junk.
  assert.equal(verifyActionToken(token, randomUUID(), now).ok, false);
  const [n, , exp, sig] = token.split(".");
  assert.equal(verifyActionToken(`${n}.${randomUUID()}.${exp}.${sig}`, nudgeId, now).ok, false);
  assert.equal(
    verifyActionToken(`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, nudgeId, now).ok,
    false,
  );
  assert.equal(verifyActionToken("nope", nudgeId, now).ok, false);
});

test("actions: each kind offers what Michael may do, at most two, the action first", () => {
  assert.deepEqual(
    actionsFor({ kind: "block_soon" }).map((a) => a.id),
    ["focus", "snooze"],
  );
  assert.deepEqual(actionsFor({ kind: "focus_drift" }), []);
  assert.deepEqual(actionsFor({ kind: "focus_drift", mac_app: "Instagram" })[0], {
    id: "mute_app",
    label: "Mute Instagram 30 min",
    app: "Instagram",
  });
  assert.deepEqual(
    actionsFor({ kind: "recovery_block", recommendation_id: randomUUID() }).map((a) => a.id),
    ["do_it", "open"],
  );
  assert.deepEqual(actionsFor({ kind: "recovery_block" }), []);
  assert.deepEqual(actionsFor({ kind: "morning" }), []);
  for (const kind of ["block_soon", "focus_drift", "recovery_block"] as const) {
    assert.ok(actionsFor({ kind, mac_app: "Slack", recommendation_id: randomUUID() }).length <= 2);
  }
});

test("buttons are worked out again from the stored line", () => {
  assert.equal(driftApp("6 min on Instagram in your focus block. Back to it until 12:00."), "Instagram");
  assert.equal(driftApp("6 min on youtube.com in your focus block. Back to it until 12:00."), null);
  assert.equal(driftApp("6 min on Terminal in your focus block. Back to it until 12:00."), null);
  assert.deepEqual(
    offeredActions({
      kind: "focus_drift",
      text: "4 min on WhatsApp in your focus block. Back to it until 12:00.",
      recommendation_id: null,
    }).map((a) => a.label),
    ["Mute WhatsApp 30 min", "Open"],
  );
});

test("deep links: the block on the Timeline, the card on Today, else Today", () => {
  const base = { day: "2026-11-15", recommendation_id: null };
  assert.equal(
    nudgeUrl({ ...base, kind: "block_soon", key: "block_soon:abc" }),
    "/timeline?day=2026-11-15&block=abc",
  );
  assert.equal(
    nudgeUrl({ ...base, kind: "focus_drift", key: "focus_drift:x:y" }),
    "/timeline?day=2026-11-15&block=x%3Ay",
  );
  // The stage's test nudge keeps the real key after its press marker.
  assert.equal(
    nudgeUrl({ ...base, kind: "block_soon", key: "test:lz1abc12345678:block_soon:abc" }),
    "/timeline?day=2026-11-15&block=abc",
  );
  const rec = randomUUID();
  assert.equal(
    nudgeUrl({ ...base, kind: "recovery_block", key: `recovery_block:${rec}`, recommendation_id: rec }),
    `/?card=${rec}`,
  );
  assert.equal(nudgeUrl({ ...base, kind: "goal_behind", key: "goal_behind" }), "/");
});

test("snooze: the line says the time left again, from the clock", () => {
  // 17:50 Athens is 15:50 UTC.
  const at = Date.parse("2026-11-15T15:50:00Z");
  const n = { kind: "block_soon" as const, day: "2026-11-15", text: "Gym at 18:00. Wrap up in 12 min." };
  assert.equal(refreshText(n, at), "Gym at 18:00. Wrap up in 10 min.");
  assert.equal(refreshText(n, Date.parse("2026-11-15T16:01:00Z")), "Gym at 18:00. It starts now.");
  assert.equal(refreshText({ ...n, kind: "goal_behind" }, at), n.text);
});

test("act over HTTP: no session, the token is the key, and it works once", async () => {
  const keys = generateVAPIDKeys();
  const sent: PushPayload[] = [];
  const sender: PushSender = async (_sub, payload) => {
    sent.push(JSON.parse(payload));
    return { statusCode: 201 };
  };
  configurePush({ vapid: { ...keys, subject: "mailto:test@example.com" }, sender });
  configureTelegram({ config: null });
  const snoozed: (() => void)[] = [];
  configureSnooze((fn) => snoozed.push(fn));

  const { n, userId } = await asNewUser(async (userId) => {
    await store.savePushDevice(
      { endpoint: "https://fcm.googleapis.com/fcm/send/t1", keys: { p256dh: "p", auth: "a" } },
      null,
    );
    return { n: await nudge(), userId };
  });
  const token = signActionToken(n.id, userId);

  // The payload the worker gets: buttons, where to post and the signed token.
  const payload = await runAsUser(userId, async () => nudgePayload(n));
  assert.deepEqual(payload.actions, [
    { action: "focus", title: "Start focus" },
    { action: "snooze", title: "Snooze 10 min" },
  ]);
  assert.match(payload.act_url ?? "", new RegExp(`/v1/nudges/${n.id}/act$`));
  assert.equal(verifyActionToken(payload.token ?? "", n.id).ok, true);
  assert.equal(payload.url, nudgeUrl(n));

  assert.equal((await act(n.id, { action: "snooze", token: "bad" })).status, 401);
  assert.equal((await act(randomUUID(), { action: "snooze", token })).status, 401);
  assert.equal((await act(n.id, { action: "open", token })).status, 400);
  // Not offered on this nudge.
  assert.equal((await act(n.id, { action: "do_it", token })).status, 409);

  let res = await act(n.id, { action: "snooze", token });
  assert.equal(res.status, 200);
  const result = NudgeActResult.parse(await res.json());
  assert.match(result.text, /^Snoozed\. Back at \d\d:\d\d\.$/);
  assert.equal(result.nudge_id, n.id);
  // Single use: the same token (or Telegram) cannot act again while it is snoozed.
  res = await act(n.id, { action: "snooze", token });
  assert.equal(res.status, 409);

  // Ten minutes later it comes back, with a fresh token, and can be acted on again.
  assert.equal(snoozed.length, 1);
  snoozed[0]?.();
  await new Promise((r) => setTimeout(r, 20));
  const again = sent.at(-1);
  assert.equal(again?.body.startsWith("Gym at 18:00."), true);
  assert.ok(again?.token);
  assert.equal((await act(n.id, { action: "snooze", token: again?.token })).status, 200);
  configurePush({ vapid: null });
});

test("do it: carries out the recommendation, undoable, and says until when", async () => {
  await asNewUser(async () => {
    const start = Date.now() + 3 * HOUR;
    const rec = await store.createRecommendation({
      goal_id: null,
      title: "Meetings ate the block. Take 25 minutes at 16:00. Still counts.",
      rationale: "test",
      action: {
        kind: "create_focus_block",
        payload: { start_at: iso(start), end_at: iso(start + 25 * 60_000), title: "Focus block" },
        involves_others: false,
        undo_until: iso(start),
      },
      source: "analysis",
    });
    const n = await nudge({
      kind: "recovery_block",
      key: `recovery_block:${rec.id}`,
      recommendation_id: rec.id,
      text: "Meetings ate the block. Take 25 minutes at 16:00. Still counts.",
    });
    const result = await actOnNudge(n.id, "do_it");
    assert.match(result.text, /^Done\. Undo in the app until \d\d:\d\d\.$/);
    assert.equal(result.url, `/?card=${rec.id}`);
    assert.equal((await store.getRecommendation(rec.id))?.status, "done");
    await assert.rejects(actOnNudge(n.id, "do_it"), /Already done/);
  });
});

test("do it: a refused action leaves the nudge open to try again", async () => {
  await asNewUser(async () => {
    const past = Date.now() - HOUR;
    const rec = await store.createRecommendation({
      goal_id: null,
      title: "Too late",
      rationale: "test",
      action: {
        kind: "create_focus_block",
        payload: { start_at: iso(past), end_at: iso(past + 25 * 60_000) },
        involves_others: false,
        undo_until: iso(past),
      },
      source: "analysis",
    });
    const n = await nudge({
      kind: "recovery_block",
      key: `recovery_block:${rec.id}`,
      recommendation_id: rec.id,
    });
    await assert.rejects(actOnNudge(n.id, "do_it"));
    // Not "Already done": the executor's own reason again.
    await assert.rejects(actOnNudge(n.id, "do_it"), (err: Error) => err.message !== "Already done.");
  });
});

test("mute: closes the app on the Mac for 30 minutes through a focus guard", async () => {
  await asNewUser(async () => {
    const n = await nudge({
      kind: "focus_drift",
      key: "focus_drift:evt-1",
      text: "6 min on Instagram in your focus block. Back to it until 12:00.",
    });
    const result = await actOnNudge(n.id, "mute_app");
    assert.match(result.text, /^Instagram is off until \d\d:\d\d\. Undo in the app\.$/);
    const { activeFocusGuards } = await import("../actions/focus-guard");
    const { guards } = await activeFocusGuards();
    assert.deepEqual(
      guards.map((g) => g.apps),
      [["Instagram"]],
    );
    assert.ok(result.undo_until && Date.parse(result.undo_until) - Date.now() > 29 * 60_000);
  });
});

test("telegram: buttons on the message, the tap acts once and says what happened", async () => {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: String(input).split("/").pop() ?? "",
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return Response.json({ ok: true, result: true });
  }) as typeof globalThis.fetch;
  configureTelegram({ config: { token: "123:abc", username: "michael_coach_bot", secret: "s" }, fetch });
  configurePush({ vapid: null });
  const snoozed: (() => void)[] = [];
  configureSnooze((fn) => snoozed.push(fn));

  const { n, userId } = await asNewUser(async (userId) => {
    await store.bindTelegramChat({ chat_id: "777", username: "manolis" }, `link-${randomUUID()}`);
    return { n: await nudge(), userId };
  });

  // Open needs an https web address; without one only the action button shows.
  const keyboard = nudgeKeyboard(n);
  assert.deepEqual(keyboard, {
    inline_keyboard: [
      [
        { text: "Start focus", callback_data: callbackData(n.id, "focus") },
        { text: "Snooze 10 min", callback_data: callbackData(n.id, "snooze") },
      ],
    ],
  });
  assert.ok(callbackData(n.id, "mute_app").length <= 64);
  assert.deepEqual(parseCallbackData(callbackData(n.id, "do_it")), { nudgeId: n.id, action: "do_it" });
  assert.equal(parseCallbackData("na:../x:snooze"), null);

  // Delivery carries the keyboard.
  await runAsUser(userId, async () => {
    const { telegramChannel } = await import("./telegram");
    assert.equal(await telegramChannel.deliver(n), "sent");
  });
  assert.deepEqual(calls.at(-1)?.body.reply_markup, keyboard);

  const tap = (chatId: number) =>
    app.request("/v1/webhooks/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "s" },
      body: JSON.stringify({
        update_id: 1,
        callback_query: {
          id: "cb1",
          from: { id: chatId },
          data: callbackData(n.id, "snooze"),
          message: { message_id: 9, chat: { id: chatId, type: "private" } },
        },
      }),
    });

  // Someone else's chat cannot act on this nudge.
  let body = (await (await tap(888)).json()) as { method: string; text: string };
  assert.equal(body.method, "answerCallbackQuery");
  assert.equal(body.text, "This chat is not connected.");

  calls.length = 0;
  body = (await (await tap(777)).json()) as { method: string; text: string };
  assert.match(body.text, /^Snoozed\. Back at/);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["editMessageReplyMarkup", "sendMessage"],
  );
  assert.equal(snoozed.length, 1);
  // A second tap: already done, said plainly.
  body = (await (await tap(777)).json()) as { method: string; text: string };
  assert.equal(body.text, "Already done.");
  configureTelegram({ config: null });
});

test("Start focus on the block about to start runs a session on its goal until the block ends (#397)", () =>
  asNewUser(async () => {
    for (const g of await store.listGoals()) await store.deleteGoal(g.id);
    const goal = await store.createGoal({
      category: "personal",
      title: "University",
      description: null,
      target: null,
      weekly_budget_minutes: 360,
      active: true,
    });
    const now = Date.now();
    const start = now + 10 * 60_000;
    const end = start + 60 * 60_000;
    const { inserted } = await store.insertEvents([
      {
        source: "agent",
        type: "calendar_event",
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        title: "University",
        data: { goal_id: goal.id, michael: true, attendees: 0 },
        external_id: `test:${randomUUID()}`,
      },
    ]);
    const block = inserted[0];
    assert.ok(block);
    const n = await nudge({ key: `block_soon:${block.id}`, text: "University at 12:00. Wrap up in 10 min." });
    const r = NudgeActResult.parse(await actOnNudge(n.id, "focus", now));
    assert.match(r.text, /^Focusing on University until \d\d:\d\d\.$/);
    const s = await store.getActiveFocusSession();
    assert.equal(s?.goal_id, goal.id);
    assert.equal(s?.event_id, block.id);
    assert.equal(s?.owns_block, false);
    // From now to the block's end, to the minute.
    assert.ok(Math.abs(Date.parse(s?.end_at ?? "") - end) < 60_000);
    // Once: a second tap is refused.
    await assert.rejects(actOnNudge(n.id, "focus", now), /Already done/);
  }));

test("Start focus is refused cleanly when the nudge has no block, and can be tried again", () =>
  asNewUser(async () => {
    const n = await nudge({ key: "block_soon:" });
    await assert.rejects(actOnNudge(n.id, "focus"), /No block on this nudge/);
    await assert.rejects(actOnNudge(n.id, "focus"), /No block on this nudge/);
  }));
