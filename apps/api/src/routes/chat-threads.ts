import Anthropic from "@anthropic-ai/sdk";
import {
  type ChatThread,
  type ChatThreadDeleted,
  type ChatThreadList,
  ChatThreadPatch,
  NewChatThread,
} from "@michael/shared";
import { Hono } from "hono";
import { z } from "zod";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";
import { NEW_THREAD_TITLE, store } from "../store";

// Separate conversations with Michael (#308). Each thread keeps its own lines; Michael carries
// context across them through memories, check ins and recent thread titles (chat.ts), never by
// reading another thread's lines.

const ThreadId = z.uuid();
const MAX_TITLE = 48;
const TITLE_TIMEOUT_MS = 4000;

// POST /v1/chat/threads may come with no body at all.
const jsonOf = async (raw: string): Promise<unknown> => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError("bad_request", "Body must be valid JSON");
  }
};

const ListQuery = z.object({
  archived: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** The thread to write in: the one named, a new one, or the latest (a new one when there is none). */
export async function threadFor(id: string | undefined): Promise<{ thread: ChatThread; fresh: boolean }> {
  if (id === "new") return { thread: await store.createChatThread(), fresh: true };
  if (id) {
    const thread = await store.getChatThread(id);
    if (!thread) throw new HttpError("not_found", "Chat thread not found");
    return { thread, fresh: false };
  }
  const latest = await latestThread();
  return latest ? { thread: latest, fresh: false } : { thread: await store.createChatThread(), fresh: true };
}

/** The thread with the latest line (pinned or not), for "open Chat where I left off". */
export async function latestThread(): Promise<ChatThread | null> {
  const threads = await store.listChatThreads({ limit: 100 });
  const at = (t: ChatThread) => Date.parse(t.last_message_at ?? t.created_at);
  return threads.reduce<ChatThread | null>((best, t) => (!best || at(t) > at(best) ? t : best), null);
}

/** True while the thread still carries the name it was born with, so the first line may name it. */
export const untitled = (t: ChatThread) => t.title === NEW_THREAD_TITLE;

/**
 * The template title: the first words of the user's first line, without the question mark. Used
 * when the model is not set up, slow, or says something that does not fit.
 */
export function templateTitle(message: string): string {
  const words = message
    .replace(/\s+/g, " ")
    .replace(/[?.!,;:]+$/g, "")
    .trim()
    .split(" ");
  let title = "";
  for (const w of words) {
    const next = title ? `${title} ${w}` : w;
    if (next.length > MAX_TITLE - 1) break;
    title = next;
    if (title.split(" ").length >= 6) break;
  }
  title ||= message.trim().slice(0, MAX_TITLE - 1);
  title = title.replace(/[?.!,;:]+$/g, "");
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : NEW_THREAD_TITLE;
}

const TITLE_SYSTEM = `You name conversations between a person and their coach, Michael.
Reply with the name only: 2 to 5 words, sentence case, British spelling, no quotes, no full stop, no emoji, no dashes.
Name the topic, the way a coach labels a note: "Exam week plan", "Sleep this week", "Gym before work", "Moving Friday's focus block".`;

let titleClient: Anthropic | null | undefined;
/** Tests only: a stand in for Claude when naming threads (null: no model, template only). */
export function setTitleClientForTests(fake: Anthropic | null | undefined) {
  titleClient = fake;
}

/** A model's name for the thread, or null when it does not fit (the caller keeps the template). */
export function acceptableTitle(raw: string): string | null {
  const title = raw
    .trim()
    .replace(/^["'“‘]+|["'”’.]+$/g, "")
    .trim();
  if (!title || title.length > MAX_TITLE || /[\n–—]|\s-\s/.test(title)) return null;
  if (title.split(/\s+/).length > 7) return null;
  return title;
}

/** Names a thread from its first line. Never throws: falls back to the template. */
export async function titleFor(message: string): Promise<string> {
  const template = templateTitle(message);
  if (titleClient === undefined && env.ANTHROPIC_API_KEY) {
    titleClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  const client = titleClient ?? null;
  if (!client) return template;
  try {
    const res = await client.messages.create(
      {
        model: env.ANTHROPIC_MODEL,
        max_tokens: 200,
        output_config: { effort: "low" },
        system: TITLE_SYSTEM,
        // Only the user's own first line: no context about their day goes into a title.
        messages: [{ role: "user", content: message.slice(0, 600) }],
      },
      { timeout: TITLE_TIMEOUT_MS, maxRetries: 0 },
    );
    if (res.stop_reason === "refusal") return template;
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return acceptableTitle(text) ?? template;
  } catch (err) {
    console.warn("chat: naming the thread failed, using the template", err);
    return template;
  }
}

export const chatThreads = new Hono()
  // GET /v1/chat/threads?archived=false&q=&limit=100  the caller's threads, pinned first
  .get("/chat/threads", async (c) => {
    const q = parse(ListQuery, {
      archived: c.req.query("archived") || undefined,
      q: c.req.query("q") || undefined,
      limit: c.req.query("limit") || undefined,
    });
    const threads = await store.listChatThreads({
      archived: q.archived === "true",
      ...(q.q ? { q: q.q } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
    const body: ChatThreadList = { threads };
    return c.json(body);
  })
  // POST /v1/chat/threads { title? }  an empty thread (the first line in it names it)
  .post("/chat/threads", async (c) => {
    const raw = await c.req.text();
    const { title } = parse(NewChatThread, raw.trim() ? await jsonOf(raw) : {});
    return c.json(await store.createChatThread(title), 201);
  })
  // PATCH /v1/chat/threads/:id { title?, pinned?, archived? }
  .patch("/chat/threads/:id", async (c) => {
    const id = parse(ThreadId, c.req.param("id"));
    const patch = parse(ChatThreadPatch, await jsonBody(c));
    const thread = await store.updateChatThread(id, patch);
    if (!thread) throw new HttpError("not_found", "Chat thread not found");
    return c.json(thread);
  })
  // DELETE /v1/chat/threads/:id  the thread and every line in it, for good
  .delete("/chat/threads/:id", async (c) => {
    const id = parse(ThreadId, c.req.param("id"));
    const messages = await store.deleteChatThread(id);
    if (messages === null) throw new HttpError("not_found", "Chat thread not found");
    const body: ChatThreadDeleted = { id, messages };
    return c.json(body);
  });
