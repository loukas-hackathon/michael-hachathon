"use server";

import type { ChatResponse } from "@michael/shared";
import { sendChat } from "@/lib/api";
import { copyFor } from "./copy";

export type SendResult = { ok: true; data: ChatResponse } | { ok: false; error: string };

// Non-streaming send, kept for callers that want the whole answer at once (voice). The typed chat
// streams through ./stream-chat.ts instead.

export async function sendMessage(message: string): Promise<SendResult> {
  const text = message.trim();
  if (!text) return { ok: false, error: "Type a question first." };
  try {
    const res = await sendChat(text.slice(0, 2000));
    if (res.ok) return res;
    console.error(`chat: ${res.code}: ${res.message}`);
    return { ok: false, error: copyFor(res.code) };
  } catch (err) {
    // bearer() throws when signed out.
    console.error("chat:", err);
    return { ok: false, error: copyFor("unauthorized") };
  }
}
