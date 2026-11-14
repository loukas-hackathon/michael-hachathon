import type { TelegramLinkResponse, TelegramStatus } from "@michael/shared";
import { Hono } from "hono";
import { HttpError } from "../http";
import { handleUpdate, secretMatches, startLink, TelegramUpdate, telegramConfig } from "../nudges/telegram";
import { store } from "../store";

async function status(): Promise<TelegramStatus> {
  const chat = telegramConfig() ? await store.getTelegramChat() : null;
  return {
    enabled: telegramConfig() !== null,
    connected: chat !== null,
    username: chat?.username ?? null,
    connected_at: chat?.connected_at ?? null,
  };
}

// The signed-in caller's Telegram chat (mounted under /v1, behind auth).
export const telegram = new Hono()
  .get("/telegram", async (c) => c.json(await status()))
  // The one tap: a t.me link that opens the bot with a signed, single use start token.
  .post("/telegram/link", async (c) => {
    const url = await startLink();
    if (!url) throw new HttpError("unavailable", "Telegram is not set up yet");
    const body: TelegramLinkResponse = { url };
    return c.json(body);
  })
  .delete("/telegram", async (c) => {
    await store.unbindTelegramChat();
    return c.json(await status());
  });

// POST /v1/webhooks/telegram: Telegram calls it with no user, so it is verified by the secret
// token set with setWebhook, and the user only ever comes from a signed start token.
export const telegramWebhook = new Hono().post("/", async (c) => {
  if (!telegramConfig()) throw new HttpError("not_found", "Telegram is not set up");
  if (!secretMatches(c.req.header("x-telegram-bot-api-secret-token"))) {
    throw new HttpError("unauthorized", "Bad secret token");
  }
  const parsed = TelegramUpdate.safeParse(await c.req.json().catch(() => null));
  // Always 200 for updates we do not read, or Telegram retries them for a day.
  if (!parsed.success) return c.json({ ok: true });
  const reply = await handleUpdate(parsed.data);
  const chat = parsed.data.message?.chat.id;
  if (!reply || chat === undefined) return c.json({ ok: true });
  // Answering in the webhook response saves a round trip to the Bot API.
  return c.json({ method: "sendMessage", chat_id: chat, text: reply });
});
