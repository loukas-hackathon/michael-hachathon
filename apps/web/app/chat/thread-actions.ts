"use server";

import type { ChatHistory, ChatThread, ChatThreadPatch } from "@michael/shared";
import { deleteChatThread, getChatHistory, getChatThreads, patchChatThread } from "@/lib/api";

// The thread list and switching, called from the chat screen. Results, never throws: the screen
// turns a failure into one line in Michael's voice and keeps what it shows.

export type ThreadResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function loadThread(id: string): Promise<ThreadResult<ChatHistory>> {
  try {
    return { ok: true, data: await getChatHistory(id) };
  } catch (err) {
    console.error("chat thread:", err);
    return { ok: false, error: "I couldn't open that conversation. Try again." };
  }
}

export async function listThreads(q?: string): Promise<ThreadResult<ChatThread[]>> {
  try {
    return { ok: true, data: await getChatThreads(q) };
  } catch (err) {
    console.error("chat threads:", err);
    return { ok: false, error: "I couldn't load your conversations. Try again." };
  }
}

export async function changeThread(id: string, patch: ChatThreadPatch): Promise<ThreadResult<ChatThread>> {
  try {
    return { ok: true, data: await patchChatThread(id, patch) };
  } catch (err) {
    console.error("chat thread patch:", err);
    return { ok: false, error: "I couldn't save that. Nothing changed." };
  }
}

export async function removeThread(id: string): Promise<ThreadResult<null>> {
  try {
    await deleteChatThread(id);
    return { ok: true, data: null };
  } catch (err) {
    console.error("chat thread delete:", err);
    return { ok: false, error: "I couldn't delete that conversation. It's still here." };
  }
}
