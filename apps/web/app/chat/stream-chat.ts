"use client";

import type { ChatResponse } from "@michael/shared";
import type { SendResult } from "./actions";
import { copyFor } from "./copy";

// Plain shape checks instead of the shared zod schemas: importing a schema would ship zod and the
// whole schema file (about 45 kB gzipped) to the chat screen (#255). The server built both bodies.
const errorCode = (json: unknown): string => {
  const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" ? code : "internal";
};

const chatResponse = (json: unknown): ChatResponse | null => {
  const body = json as Partial<ChatResponse> | null;
  if (!body || typeof body !== "object" || !body.message || !body.reply) return null;
  return { ...body, actions: Array.isArray(body.actions) ? body.actions : [] } as ChatResponse;
};

// When each thread was last warmed, so focusing the box again and again asks once.
const WARM_EVERY_MS = 30_000;
const warmedAt = new Map<string, number>();

/**
 * The chat is open on this thread: the API reads the day now and warms the model with it, so the
 * first words of the next answer come without that wait (#364). Fire and forget; `force` after an
 * answer that changed the day.
 */
export function warmChat(threadId: string, force = false) {
  const now = Date.now();
  if (!force && now - (warmedAt.get(threadId) ?? 0) < WARM_EVERY_MS) return;
  warmedAt.set(threadId, now);
  void fetch("/chat/warm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ thread_id: threadId }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Sends one line and reads Michael's answer as it is written (server-sent events from
 * /chat/stream). `onText` gets each new piece; the result carries the stored pair, as sendMessage's.
 */
export async function streamChat(
  message: string,
  threadId: string | null,
  onText: (text: string) => void,
  spoken = false,
): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        ...(spoken ? { spoken } : {}),
        ...(threadId ? { thread_id: threadId } : {}),
      }),
    });
  } catch {
    return { ok: false, error: copyFor("network"), code: "network" };
  }
  if (!res.ok || !res.body) {
    const code = errorCode(await res.json().catch(() => null));
    return { ok: false, error: copyFor(code), code };
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // Events end with a blank line; keep any half event for the next chunk.
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = /^event: ?(.*)$/m.exec(block)?.[1];
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!event || !data) continue;
      const json: unknown = JSON.parse(data);
      if (event === "delta") onText((json as { text: string }).text);
      if (event === "done") {
        const body = chatResponse(json);
        if (body) return { ok: true, data: body };
      }
      if (event === "error") {
        const code = errorCode(json);
        return { ok: false, error: copyFor(code), code };
      }
    }
  }
  // The stream ended without a reply (connection dropped mid answer).
  return { ok: false, error: copyFor("network"), code: "network" };
}
