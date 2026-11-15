"use client";

import type { ChatResponse, ChatStep } from "@michael/shared";
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
 * /chat/stream). `onText` gets each new piece, `onStep` each step of the work; the result carries the stored pair, as sendMessage's.
 */
export async function streamChat(
  message: string,
  threadId: string | null,
  onText: (text: string) => void,
  spoken = false,
  /** How Michael is working it out (`step` events): each running then done. */
  onStep?: (step: ChatStep) => void,
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
    // No network at all (venue wifi down): "Failed to fetch". The line goes back in the box.
    return failed("offline");
  }
  try {
    return await readReply(res, onText, onStep);
  } catch {
    // The connection dropped mid answer: reading the body throws ("network error", "Failed to
    // fetch"). Caught here so it is one line under the box, never an uncaught page error.
    return failed(isOffline() ? "offline" : "network");
  }
}

const failed = (code: string): SendResult => ({ ok: false, error: copyFor(code), code });
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Reads the server-sent events of one answer to the end. Throws only when the network does. */
async function readReply(
  res: Response,
  onText: (text: string) => void,
  onStep?: (step: ChatStep) => void,
): Promise<SendResult> {
  if (!res.ok || !res.body) {
    return failed(errorCode(await res.json().catch(() => null)));
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
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "delta") onText((json as { text: string }).text);
      if (event === "step" && onStep) {
        const step = json as Partial<ChatStep> | null;
        if (step && typeof step.id === "string" && typeof step.label === "string") {
          onStep({ id: step.id, label: step.label, status: step.status === "done" ? "done" : "running" });
        }
      }
      if (event === "done") {
        const body = chatResponse(json);
        if (body) return { ok: true, data: body };
      }
      if (event === "error") {
        return failed(errorCode(json));
      }
    }
  }
  // The stream ended without a reply (connection dropped mid answer).
  return failed(isOffline() ? "offline" : "network");
}
