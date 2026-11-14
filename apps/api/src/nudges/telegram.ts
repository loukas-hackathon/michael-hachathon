import { createHmac, timingSafeEqual } from "node:crypto";
import type { Nudge, NudgeStatus } from "@michael/shared";
import { z } from "zod";
import { currentUserId, runAsUser } from "../context";
import { env } from "../env";
import { store } from "../store";
import type { DeliveryChannel } from "./channels";

// Telegram: a backup channel for nudges. The user taps "Connect Telegram" on You, which opens
// t.me/<bot>?start=<token>; the bot's webhook gets "/start <token>" and binds that chat to them.
// Telegram mirrors its notifications to the Apple Watch, so the stage moment survives Web Push.

export interface TelegramConfig {
  token: string;
  /** The bot's @username without the @; null until asked from Telegram (getMe). */
  username: string | null;
  /** Telegram sends it back on every webhook call (X-Telegram-Bot-Api-Secret-Token). */
  secret: string;
}

// Telegram allows 1 to 256 characters of A-Z, a-z, 0-9, _ and - in a webhook secret.
const deriveSecret = (token: string) =>
  createHmac("sha256", token).update("michael-telegram-webhook").digest("base64url").slice(0, 48);

let config: TelegramConfig | null = env.TELEGRAM_BOT_TOKEN
  ? {
      token: env.TELEGRAM_BOT_TOKEN,
      username: env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || null,
      secret: env.TELEGRAM_WEBHOOK_SECRET || deriveSecret(env.TELEGRAM_BOT_TOKEN),
    }
  : null;
let fetcher: typeof fetch = (input, init) => fetch(input, init);

export const telegramConfig = (): TelegramConfig | null => config;

/** Tests only: swap the bot and the network call. */
export function configureTelegram(next: {
  config?: (Omit<TelegramConfig, "secret"> & { secret?: string }) | null;
  fetch?: typeof fetch;
}) {
  if (next.config !== undefined) {
    config = next.config && { ...next.config, secret: next.config.secret ?? deriveSecret(next.config.token) };
  }
  if (next.fetch) fetcher = next.fetch;
}

type ApiResult<T> = { ok: true; result: T } | { ok: false; status: number; description: string };

/** One Bot API call. Never throws: a network error reads as status 0. */
export async function telegramApi<T = unknown>(method: string, body: object): Promise<ApiResult<T>> {
  const c = config;
  if (!c) return { ok: false, status: 0, description: "Telegram is not configured" };
  try {
    const res = await fetcher(`https://api.telegram.org/bot${c.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (res.ok && json.ok) return { ok: true, result: json.result as T };
    return { ok: false, status: res.status, description: json.description ?? res.statusText };
  } catch (err) {
    return { ok: false, status: 0, description: err instanceof Error ? err.message : String(err) };
  }
}

/** The bot's username: from env, else asked once from Telegram. */
export async function botUsername(): Promise<string | null> {
  const c = config;
  if (!c) return null;
  if (c.username) return c.username;
  const me = await telegramApi<{ username?: string }>("getMe", {});
  if (me.ok && me.result.username) c.username = me.result.username;
  return c.username;
}

// ---------- the one-time start token ----------

// t.me deep links carry at most 64 characters of A-Z, a-z, 0-9, _ and -. So the token is fixed
// width with no separators: the user id as 32 hex, the expiry in base36 seconds (7), then a
// truncated HMAC (22). It is single use: the store remembers the last token that bound a chat.
const LINK_TTL_MS = 15 * 60_000;
const linkKey = () => createHmac("sha256", env.API_KEY).update("michael-telegram-link").digest();
const mac = (body: string) => createHmac("sha256", linkKey()).update(body).digest("base64url").slice(0, 22);

export function signLink(userId: string, now = Date.now()): string {
  const exp = Math.ceil((now + LINK_TTL_MS) / 1000)
    .toString(36)
    .padStart(7, "0");
  const body = `${userId.replace(/-/g, "")}${exp}`;
  return `${body}${mac(body)}`;
}

/** The user id, or null when the token is forged, tampered with or expired. */
export function verifyLink(token: string, now = Date.now()): string | null {
  if (!/^[0-9a-f]{32}[0-9a-z]{7}[\w-]{22}$/.test(token)) return null;
  const body = token.slice(0, 39);
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(token.slice(39));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number.parseInt(body.slice(32), 36) * 1000 < now) return null;
  const h = body.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** https://t.me/<bot>?start=<token> for the current user, or null when the bot is not set up. */
export async function startLink(): Promise<string | null> {
  const username = await botUsername();
  if (!username) return null;
  return `https://t.me/${username}?start=${signLink(currentUserId())}`;
}

// ---------- the webhook ----------

export function secretMatches(given: string | undefined): boolean {
  const c = config;
  if (!c || !given) return false;
  const a = Buffer.from(c.secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Only the fields we read; zod drops the rest.
export const TelegramUpdate = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: z.object({ id: z.number(), type: z.string() }),
      from: z.object({ username: z.string().optional() }).optional(),
      text: z.string().optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof TelegramUpdate>;

// What the bot says. Short, British, no dashes.
export const REPLIES = {
  connected: "Connected. I'll keep it short.",
  expired: "That link has expired. Tap Connect Telegram in Michael again.",
  used: "That link was used already. Tap Connect Telegram in Michael again.",
  hello: "Open Michael, go to You and tap Connect Telegram.",
  stopped: "Disconnected. No more nudges here.",
  notConnected: "Nothing to stop. This chat is not connected.",
  onlyNudges: "I only send nudges here. Talk to me in Michael.",
  groups: "I only work in a private chat.",
} as const;

/**
 * Handles one update and returns the reply to send, or null for none. /start <token> binds the
 * chat to the token's user, /stop unbinds it. The user id only ever comes from a signed token.
 */
export async function handleUpdate(update: TelegramUpdate, now = Date.now()): Promise<string | null> {
  const msg = update.message;
  const text = msg?.text?.trim();
  if (!msg || !text) return null;
  if (msg.chat.type !== "private") return REPLIES.groups;
  const chatId = String(msg.chat.id);
  const [command = "", arg] = text.split(/\s+/);
  const cmd = command.replace(/@\w+$/, "").toLowerCase();

  if (cmd === "/start") {
    if (!arg) return (await store.telegramChatOwner(chatId)) ? REPLIES.connected : REPLIES.hello;
    const userId = verifyLink(arg, now);
    if (!userId) return REPLIES.expired;
    const result = await runAsUser(userId, () =>
      store.bindTelegramChat({ chat_id: chatId, username: msg.from?.username ?? null }, arg),
    );
    return result === "bound" ? REPLIES.connected : REPLIES.used;
  }
  if (cmd === "/stop") {
    const owner = await store.telegramChatOwner(chatId);
    if (!owner) return REPLIES.notConnected;
    await runAsUser(owner, () => store.unbindTelegramChat());
    return REPLIES.stopped;
  }
  return (await store.telegramChatOwner(chatId)) ? REPLIES.onlyNudges : REPLIES.hello;
}

/** Points the bot at this API. Telegram treats a repeat as a no-op, so it runs on every start. */
export async function registerWebhook(publicApiUrl = env.PUBLIC_API_URL): Promise<boolean> {
  const c = config;
  if (!c) return false;
  const url = `${publicApiUrl.replace(/\/$/, "")}/v1/webhooks/telegram`;
  if (!url.startsWith("https://")) {
    console.log(`[telegram] webhook not set: Telegram needs https, got ${url}`);
    return false;
  }
  const res = await telegramApi("setWebhook", {
    url,
    secret_token: c.secret,
    allowed_updates: ["message"],
  });
  if (!res.ok) console.error(`[telegram] setWebhook failed: ${res.status} ${res.description}`);
  else console.log(`[telegram] webhook set to ${url}`);
  return res.ok;
}

// ---------- delivery ----------

/** Sends one line to the current user's bound chat. */
export async function telegramToCurrentUser(text: string): Promise<{ chats: number; delivered: number }> {
  if (!config) return { chats: 0, delivered: 0 };
  const chat = await store.getTelegramChat();
  if (!chat) return { chats: 0, delivered: 0 };
  const res = await telegramApi("sendMessage", { chat_id: chat.chat_id, text });
  if (res.ok) return { chats: 1, delivered: 1 };
  // 403: the user blocked the bot or deleted the chat. Forget it, as push forgets gone devices.
  if (res.status === 403) await store.unbindTelegramChat();
  console.error(`[telegram] sendMessage failed: ${res.status} ${res.description}`);
  return { chats: 1, delivered: 0 };
}

export const telegramChannel: DeliveryChannel = {
  name: "telegram",
  async deliver(nudge: Nudge): Promise<NudgeStatus> {
    const { chats, delivered } = await telegramToCurrentUser(nudge.text);
    if (chats === 0) return "queued";
    return delivered > 0 ? "sent" : "failed";
  },
};
