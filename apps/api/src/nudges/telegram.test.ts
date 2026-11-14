import assert from "node:assert/strict";
import { test } from "node:test";
import { NudgeTestResult, TelegramLinkResponse, TelegramStatus } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { store } from "../store";
import { allOf, type DeliveryChannel } from "./channels";
import { configurePush } from "./push";
import {
  configureTelegram,
  REPLIES,
  registerWebhook,
  signLink,
  telegramChannel,
  verifyLink,
} from "./telegram";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });

const SECRET = "test-secret";
const hook = (update: unknown, secret: string | null = SECRET) =>
  app.request("/v1/webhooks/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}),
    },
    body: JSON.stringify(update),
  });

const message = (chatId: number, text: string, type = "private") => ({
  update_id: Math.floor(Math.random() * 1e9),
  message: {
    message_id: 1,
    chat: { id: chatId, type },
    from: { id: chatId, username: "manolis" },
    text,
    date: 0,
  },
});

/** A fake Bot API: records every call, answers sendMessage with `status`. */
function fakeTelegram(status = 200) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = String(input).split("/").pop() ?? "";
    calls.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
    if (method === "getMe") return Response.json({ ok: true, result: { username: "michael_coach_bot" } });
    if (method === "sendMessage" && status !== 200) {
      return Response.json({ ok: false, description: "Forbidden: bot was blocked by the user" }, { status });
    }
    return Response.json({ ok: true, result: true });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const OTHER = "00000000-0000-4000-8000-00000000ff43";

test("telegram: start tokens are signed, short enough for t.me, single user and expire", () => {
  const now = Date.parse("2026-11-14T20:00:00Z");
  const token = signLink(env.DEMO_USER_ID, now);
  assert.ok(token.length <= 64);
  assert.match(token, /^[\w-]+$/);
  assert.equal(verifyLink(token, now), env.DEMO_USER_ID);
  assert.equal(verifyLink(token, now + 16 * 60_000), null);
  // Tampered user id or mac.
  const forged = `${OTHER.replace(/-/g, "")}${token.slice(32)}`;
  assert.equal(verifyLink(forged, now), null);
  assert.equal(verifyLink(`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, now), null);
  assert.equal(verifyLink("hello", now), null);
});

test("telegram: without a bot token the button says so and nothing breaks", async () => {
  configureTelegram({ config: null });
  const status = TelegramStatus.parse(await (await call("GET", "/v1/telegram")).json());
  assert.deepEqual(status, { enabled: false, connected: false, username: null, connected_at: null });
  assert.equal((await call("POST", "/v1/telegram/link")).status, 503);
  assert.equal((await hook(message(1, "/start"))).status, 404);
  assert.equal(await telegramChannel.deliver({ text: "x" } as never), "queued");
});

test("telegram: one tap connect, nudges arrive, /stop and Disconnect", async () => {
  const bot = fakeTelegram();
  configureTelegram({ config: { token: "123:abc", username: null, secret: SECRET }, fetch: bot.fetch });
  configurePush({ vapid: null });

  // The link opens the bot with a start token; the username comes from getMe once.
  let res = await call("POST", "/v1/telegram/link");
  assert.equal(res.status, 200);
  const { url } = TelegramLinkResponse.parse(await res.json());
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://t.me/michael_coach_bot");
  const token = parsed.searchParams.get("start") ?? "";
  assert.equal(verifyLink(token), env.DEMO_USER_ID);

  // The webhook checks Telegram's secret header.
  assert.equal((await hook(message(4242, `/start ${token}`), null)).status, 401);
  assert.equal((await hook(message(4242, `/start ${token}`), "wrong")).status, 401);

  res = await hook(message(4242, `/start ${token}`));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { method: "sendMessage", chat_id: 4242, text: REPLIES.connected });
  const status = TelegramStatus.parse(await (await call("GET", "/v1/telegram")).json());
  assert.equal(status.connected, true);
  assert.equal(status.username, "manolis");

  // The same link works once; a forged one never.
  res = await hook(message(5555, `/start ${token}`));
  assert.equal(((await res.json()) as { text: string }).text, REPLIES.used);
  res = await hook(message(5555, "/start nottoken"));
  assert.equal(((await res.json()) as { text: string }).text, REPLIES.expired);
  // Groups are refused; updates we do not read still get a 200.
  res = await hook(message(-100, `/start ${token}`, "group"));
  assert.equal(((await res.json()) as { text: string }).text, REPLIES.groups);
  assert.equal((await hook({ update_id: 1, edited_message: {} })).status, 200);

  // The test nudge reaches the chat (no push configured: the chat is the one device).
  res = await call("POST", "/v1/nudges/test");
  const result = NudgeTestResult.parse(await res.json());
  assert.equal(result.devices, 1);
  assert.equal(result.delivered, 1);
  const sent = bot.calls.filter((c) => c.method === "sendMessage");
  assert.deepEqual(sent.at(-1)?.body, { chat_id: "4242", text: result.text });

  // Another user never sees this chat.
  assert.equal(await runAsUser(OTHER, () => store.getTelegramChat()), null);

  // /stop unbinds; the channel then has nowhere to send.
  res = await hook(message(4242, "/stop"));
  assert.equal(((await res.json()) as { text: string }).text, REPLIES.stopped);
  assert.equal(TelegramStatus.parse(await (await call("GET", "/v1/telegram")).json()).connected, false);
  assert.equal(
    await runAsUser(env.DEMO_USER_ID, () => telegramChannel.deliver({ text: "x" } as never)),
    "queued",
  );

  // Connect again with a fresh link, then Disconnect on You.
  const again = signLink(env.DEMO_USER_ID, Date.now() + 1000);
  await hook(message(4242, `/start ${again}`));
  res = await call("DELETE", "/v1/telegram");
  assert.equal(TelegramStatus.parse(await res.json()).connected, false);
});

test("telegram: a blocked bot fails the nudge and forgets the chat", async () => {
  const bot = fakeTelegram(403);
  configureTelegram({
    config: { token: "123:abc", username: "michael_coach_bot", secret: SECRET },
    fetch: bot.fetch,
  });
  await hook(message(7777, `/start ${signLink(OTHER)}`));
  const status = await runAsUser(OTHER, () => telegramChannel.deliver({ text: "Gym at 18:00." } as never));
  assert.equal(status, "failed");
  assert.equal(await runAsUser(OTHER, () => store.getTelegramChat()), null);
});

test("telegram: setWebhook points at the API with the secret, https only", async () => {
  const bot = fakeTelegram();
  configureTelegram({
    config: { token: "123:abc", username: "michael_coach_bot", secret: SECRET },
    fetch: bot.fetch,
  });
  assert.equal(await registerWebhook("http://localhost:8787"), false);
  assert.equal(bot.calls.length, 0);
  assert.equal(await registerWebhook("https://api.example.com/"), true);
  assert.deepEqual(bot.calls[0], {
    method: "setWebhook",
    body: {
      url: "https://api.example.com/v1/webhooks/telegram",
      secret_token: SECRET,
      allowed_updates: ["message"],
    },
  });
  configureTelegram({ config: null });
});

test("channels: push and Telegram together, sent when either took it", async () => {
  const fixed = (name: "push" | "telegram", s: "sent" | "failed" | "queued"): DeliveryChannel => ({
    name,
    deliver: async () => s,
  });
  const broken: DeliveryChannel = {
    name: "telegram",
    deliver: async () => Promise.reject(new Error("down")),
  };
  const n = { text: "x" } as never;
  assert.equal(await allOf([fixed("push", "failed"), fixed("telegram", "sent")]).deliver(n), "sent");
  assert.equal(await allOf([fixed("push", "queued"), broken]).deliver(n), "failed");
  assert.equal(await allOf([fixed("push", "queued"), fixed("telegram", "queued")]).deliver(n), "queued");
  assert.equal(allOf([fixed("push", "sent"), fixed("telegram", "sent")]).name, "push");
});
