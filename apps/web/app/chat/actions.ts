"use server";

import type { ChatResponse } from "@michael/shared";
import { sendChat } from "@/lib/api";

export type SendResult = { ok: true; data: ChatResponse } | { ok: false; error: string };

// Michael's voice for the ways a send can fail. The API's own message stays in the server log.
function copyFor(code: string): string {
  if (code === "unavailable") return "I can't talk yet. Chat switches on once the team adds my key.";
  if (code === "network") return "I can't reach the server. Try again in a minute.";
  if (code === "bad_request") return "Keep it under 2000 characters and try again.";
  if (code === "unauthorized") return "Your session ran out. Sign in again and ask me once more.";
  return "Something went wrong on my side. Try again.";
}

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
