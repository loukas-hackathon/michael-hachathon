"use client";

import { ApiError, ChatResponse } from "@michael/shared";
import type { SendResult } from "./actions";
import { copyFor } from "./copy";

/**
 * Sends one line and reads Michael's answer as it is written (server-sent events from
 * /chat/stream). `onText` gets each new piece; the result carries the stored pair, as sendMessage's.
 */
export async function streamChat(message: string, onText: (text: string) => void): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch {
    return { ok: false, error: copyFor("network") };
  }
  if (!res.ok || !res.body) {
    const err = ApiError.safeParse(await res.json().catch(() => null));
    return { ok: false, error: copyFor(err.success ? err.data.error.code : "internal") };
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
        const body = ChatResponse.safeParse(json);
        if (body.success) return { ok: true, data: body.data };
      }
      if (event === "error") {
        const err = ApiError.safeParse(json);
        return { ok: false, error: copyFor(err.success ? err.data.error.code : "internal") };
      }
    }
  }
  return { ok: false, error: copyFor("internal") };
}
