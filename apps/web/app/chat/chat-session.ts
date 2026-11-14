"use client";

import type { ChatMessage, Recommendation } from "@michael/shared";
import { useSyncExternalStore } from "react";
import { TABS_STALE } from "@/components/tab-bar";
import { speakReply } from "@/components/voice/speech";
import { streamChat } from "./stream-chat";

// `key` keeps a bubble's identity when its temporary id is swapped for the stored one, so it does
// not pop in twice.
export type Line = Pick<ChatMessage, "id" | "role" | "content"> & { created_at: string | null; key?: string };

/**
 * The open conversation, kept outside React so it outlives the Chat screen. Leaving for another
 * tab keeps the draft and lets a reply finish streaming in the background; coming back shows it.
 *
 * Deliberately not a transition: an async startTransition stays pending until the whole reply has
 * streamed, and React holds every other transition (a tab tap is one) until it ends. That froze
 * the tab bar for as long as Michael was answering.
 */
type Session = {
  /** Lines added since the page loaded: sent lines, the reply as it grows, the stored pair. */
  lines: Line[];
  draft: string;
  error: string | null;
  pending: boolean;
  /** The reply being written, while it streams. */
  streamingId: string | null;
  /** What Michael did while answering, by reply id: shown as "Done. Undo" chips. */
  acted: Record<string, Recommendation[]>;
};

const EMPTY: Session = { lines: [], draft: "", error: null, pending: false, streamingId: null, acted: {} };
// Only the browser ever writes this; the server always renders EMPTY so no user's chat leaks.
let session = EMPTY;
const listeners = new Set<() => void>();

function set(patch: Partial<Session> | ((s: Session) => Partial<Session>)) {
  session = { ...session, ...(typeof patch === "function" ? patch(session) : patch) };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useChatSession(): Session {
  return useSyncExternalStore(
    subscribe,
    () => session,
    () => EMPTY,
  );
}

/** Server history first, then whatever this page added that the history does not hold yet. */
export function mergeLines(initial: Line[], added: Line[]): Line[] {
  if (!added.length) return initial;
  const known = new Set(initial.map((l) => l.id));
  return [...initial, ...added.filter((l) => !known.has(l.id))];
}

export const setDraft = (draft: string) => set({ draft });
/** Lines added since the page loaded, so a view can show only what comes after now. */
export const chatLineCount = () => session.lines.length;
export const setError = (error: string | null) => set({ error });

/**
 * Sends one line and streams the answer into the session. Resolves when the reply is stored or
 * has failed; `onFailed` lets a mounted screen put the cursor back in the box. `spoken` asks for
 * an answer to be read aloud (brief, no lists): the conversation speaks it itself.
 */
export async function sendLine(
  text: string,
  opts: { viaVoice?: boolean; elevenlabs?: boolean; spoken?: boolean; onFailed?: () => void } = {},
): Promise<{ ok: true; reply: string } | { ok: false; error: string } | null> {
  const message = text.trim();
  if (!message || session.pending) return null;
  const tempId = `pending-${Date.now()}`;
  const replyId = `${tempId}-reply`;
  set((s) => ({
    error: null,
    draft: "",
    pending: true,
    lines: [...s.lines, { id: tempId, role: "user", content: message, created_at: null }],
  }));

  // Michael's answer grows in its own bubble as it is written, then swaps for the stored pair.
  let streamed = "";
  const res = await streamChat(
    message,
    (piece) => {
      streamed += piece;
      const content = streamed;
      set((s) => ({
        streamingId: replyId,
        lines: [
          ...s.lines.filter((x) => x.id !== replyId),
          { id: replyId, role: "assistant", content, created_at: null },
        ],
      }));
    },
    opts.spoken,
  );
  const temp = (x: Line) => x.id !== tempId && x.id !== replyId;
  if (res.ok) {
    const done = res.data.actions;
    set((s) => ({
      pending: false,
      streamingId: null,
      lines: [
        ...s.lines.filter(temp),
        { ...res.data.message, key: tempId },
        { ...res.data.reply, key: replyId },
      ],
      acted: done.length ? { ...s.acted, [res.data.reply.id]: done } : s.acted,
    }));
    // Michael changed the day: cached Today and Timeline must not show the old plan.
    if (done.length) window.dispatchEvent(new Event(TABS_STALE));
    // Spoken once the whole answer is in: a voice reading half sentences sounds broken.
    if (opts.viaVoice) void speakReply(res.data.reply.content, opts.elevenlabs ?? false);
    return { ok: true, reply: res.data.reply.content };
  }
  // Nothing was stored: take the line back and put it in the box so it can be sent again.
  set((s) => ({
    pending: false,
    streamingId: null,
    lines: s.lines.filter(temp),
    draft: s.draft || message,
    error: res.error,
  }));
  if (opts.viaVoice) void speakReply(res.error, false);
  else opts.onFailed?.();
  return { ok: false, error: res.error };
}
