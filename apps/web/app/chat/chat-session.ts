"use client";

import type { ChatMessage, ChatStep, ChatThread, Recommendation } from "@michael/shared";
import { useSyncExternalStore } from "react";
import { keepSteps } from "@/components/chat/steps";
import { announceFocus } from "@/components/focus/focus-events";
import { TABS_STALE } from "@/components/tab-bar";
import { speakReply } from "@/components/voice/speech";
import { streamChat, warmChat } from "./stream-chat";
import { changeThread, listThreads, loadThread, removeThread, type ThreadResult } from "./thread-actions";

/**
 * A server action call that rejects instead of answering: with no network the browser throws
 * "Failed to fetch" before the action runs. Turned into the action's own failure shape, so the
 * thread list (open beside the chat on a laptop) never throws an uncaught page error offline.
 */
export async function reach<T>(
  call: () => Promise<ThreadResult<T>>,
  error: string,
): Promise<ThreadResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error };
  }
}
const OFFLINE_LIST = "I could not reach the server. Your conversations are as they were.";

// `key` keeps a bubble's identity when its temporary id is swapped for the stored one, so it does
// not pop in twice.
export type Line = Pick<ChatMessage, "id" | "role" | "content"> & { created_at: string | null; key?: string };

/**
 * The conversations, kept outside React so they outlive the Chat screen. Leaving for another tab
 * keeps every draft and lets a reply finish streaming in the background, in whichever thread it
 * was asked; coming back shows it.
 *
 * Deliberately not a transition: an async startTransition stays pending until the whole reply has
 * streamed, and React holds every other transition (a tab tap is one) until it ends. That froze
 * the tab bar for as long as Michael was answering.
 */
export type ThreadState = {
  /** History fetched on switching to this thread; null until then (the server's thread uses props). */
  loaded: Line[] | null;
  /** Lines added since: sent lines, the reply as it grows, the stored pair. */
  lines: Line[];
  draft: string;
  error: string | null;
  pending: boolean;
  /** The reply being written, while it streams. */
  streamingId: string | null;
  /** What Michael did while answering, by reply id: shown as "Done. Undo" chips. */
  acted: Record<string, Recommendation[]>;
  /** How Michael is working out the answer in progress (`step` events), in order. */
  steps: ChatStep[];
  /** The steps behind each answer given on this page, by reply id: "How I worked it out". */
  worked: Record<string, ChatStep[]>;
};

type Session = {
  /** The open thread: a thread id, or `new:...` for a new chat not sent yet. Null: the server's. */
  key: string | null;
  byKey: Record<string, ThreadState>;
  /** The list as last fetched or changed here; null until then (the server's list is used). */
  threads: ChatThread[] | null;
  /** Threads deleted with the Undo still on offer: out of the list, deleted when the time is up. */
  deleting: string[];
  /** A thread being fetched after a switch. */
  opening: string | null;
  /** One line about the list (a rename, a pin, a delete that failed). */
  listError: string | null;
};

export const EMPTY_THREAD: ThreadState = {
  loaded: null,
  lines: [],
  draft: "",
  error: null,
  pending: false,
  streamingId: null,
  acted: {},
  steps: [],
  worked: {},
};
const EMPTY: Session = { key: null, byKey: {}, threads: null, deleting: [], opening: null, listError: null };
// Only the browser ever writes this; the server always renders EMPTY so no user's chat leaks.
let session = EMPTY;
const listeners = new Set<() => void>();

function set(patch: Partial<Session> | ((s: Session) => Partial<Session>)) {
  session = { ...session, ...(typeof patch === "function" ? patch(session) : patch) };
  for (const l of listeners) l();
}

/** Changes one thread's state, wherever the screen is. */
function setThread(key: string, patch: Partial<ThreadState> | ((t: ThreadState) => Partial<ThreadState>)) {
  set((s) => {
    const t = s.byKey[key] ?? EMPTY_THREAD;
    return { byKey: { ...s.byKey, [key]: { ...t, ...(typeof patch === "function" ? patch(t) : patch) } } };
  });
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

export const isNewKey = (key: string) => key.startsWith("new:");

/** Pinned first, then the latest line (creation while empty), newest first, as the API orders. */
export const byActivity = (a: ChatThread, b: ChatThread) =>
  Number(b.pinned) - Number(a.pinned) ||
  Date.parse(b.last_message_at ?? b.created_at) - Date.parse(a.last_message_at ?? a.created_at);

/** Server history first, then whatever this page added that the history does not hold yet. */
export function mergeLines(initial: Line[], added: Line[]): Line[] {
  if (!added.length) return initial;
  const known = new Set(initial.map((l) => l.id));
  return [...initial, ...added.filter((l) => !known.has(l.id))];
}

/** Each stored answer's actions, by reply id, from the history's action_ids. */
export function actedFrom(messages: ChatMessage[], actions: Recommendation[]) {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const out: Record<string, Recommendation[]> = {};
  for (const m of messages) {
    const list = (m.action_ids ?? []).flatMap((id) => byId.get(id) ?? []);
    if (list.length) out[m.id] = list;
  }
  return out;
}

const currentKey = (fallback: string) => session.key ?? fallback;

// The thread the server rendered, as the Chat screen last said; for callers outside it (the voice
// conversation) that do not know it.
let serverKey = "new:server";
export function setServerKey(key: string) {
  serverKey = key;
}

/** Lines added to the open thread since the page loaded. */
export const currentLines = (s: Session): Line[] => s.byKey[s.key ?? serverKey]?.lines ?? [];
/** The steps of the answer in progress in the open thread (the voice conversation shows them). */
export const currentSteps = (s: Session): ChatStep[] => s.byKey[s.key ?? serverKey]?.steps ?? [];
/** How many, so a view can show only what comes after now. */
export const chatLineCount = () => currentLines(session).length;

export const setDraft = (key: string, draft: string) => setThread(key, { draft });
export const setError = (key: string, error: string | null) => setThread(key, { error });

/** Puts the server's latest list in, keeping threads made here that it does not know yet. */
export function syncThreads(fresh: ChatThread[]) {
  set((s) => {
    const known = new Set(fresh.map((t) => t.id));
    const local = (s.threads ?? []).filter((t) => !known.has(t.id) && s.byKey[t.id]);
    return { threads: [...fresh, ...local].sort(byActivity) };
  });
}

/** Fetches the list again (the sheet opening, a search cleared); what is shown stays meanwhile. */
export async function refreshThreads() {
  const res = await reach(() => listThreads(), OFFLINE_LIST);
  if (res.ok) syncThreads(res.data);
}

function upsertThread(thread: ChatThread, base: ChatThread[]) {
  set((s) => ({
    threads: [thread, ...(s.threads ?? base).filter((t) => t.id !== thread.id)].sort(byActivity),
  }));
}

/** A new chat: an empty page with starters. The thread is made by the first line. */
export function newThread(fallback: string) {
  const key = currentKey(fallback);
  const t = session.byKey[key];
  // Already on an empty new chat: stay, keep its draft.
  if (isNewKey(key) && !(t?.lines.length ?? 0)) return;
  const fresh = `new:${Date.now()}`;
  set((s) => ({ key: fresh, byKey: { ...s.byKey, [fresh]: { ...EMPTY_THREAD, loaded: [] } } }));
}

/**
 * Opens a thread. Its lines come from the cache when this page has them (or `fromProps` when the
 * server rendered it), otherwise from the API; the screen shows bones until they land.
 */
export async function openThread(id: string, opts: { fromProps: boolean }) {
  set({ key: id });
  const cached = session.byKey[id]?.loaded;
  if (opts.fromProps || cached) return;
  set({ opening: id });
  const res = await reach(() => loadThread(id), "I couldn't open that conversation. Try again.");
  if (res.ok) {
    const lines = res.data.messages.map((m): Line => ({ ...m }));
    setThread(id, (t) => ({
      loaded: lines,
      acted: { ...actedFrom(res.data.messages, res.data.actions), ...t.acted },
    }));
  } else {
    setThread(id, { error: res.error });
  }
  set((s) => (s.opening === id ? { opening: null } : {}));
}

/** Renames or pins at once; puts it back with one line if the API says no. */
export async function editThread(
  id: string,
  patch: { title?: string; pinned?: boolean },
  base: ChatThread[],
) {
  const list = session.threads ?? base;
  const before = list.find((t) => t.id === id);
  if (!before) return;
  upsertThread({ ...before, ...patch }, list);
  set({ listError: null });
  const res = await reach(() => changeThread(id, patch), "I couldn't save that. Nothing changed.");
  if (res.ok) upsertThread(res.data, list);
  else {
    upsertThread(before, list);
    set({ listError: res.error });
  }
}

const UNDO_MS = 5000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Takes a thread out of the list with Undo on offer for five seconds, then deletes it for good.
 * The open thread moves to the next latest, or a new chat.
 */
export function deleteThread(id: string, base: ChatThread[], fallback: string) {
  if (timers.has(id)) return;
  set((s) => ({ deleting: [...s.deleting, id], listError: null }));
  if (currentKey(fallback) === id) {
    const next = (session.threads ?? base)
      .filter((t) => t.id !== id && !session.deleting.includes(t.id))
      .sort(
        (a, b) =>
          Date.parse(b.last_message_at ?? b.created_at) - Date.parse(a.last_message_at ?? a.created_at),
      )[0];
    if (next) void openThread(next.id, { fromProps: next.id === fallback });
    else newThread(fallback);
  }
  timers.set(
    id,
    setTimeout(async () => {
      timers.delete(id);
      const res = await reach(
        () => removeThread(id),
        "I couldn't delete that conversation. It's still here.",
      );
      set((s) => {
        const deleting = s.deleting.filter((x) => x !== id);
        if (!res.ok) return { deleting, listError: res.error };
        const { [id]: _gone, ...byKey } = s.byKey;
        return { deleting, byKey, threads: (s.threads ?? base).filter((t) => t.id !== id) };
      });
    }, UNDO_MS),
  );
}

/** Undo: the thread comes back where it was; nothing was deleted. */
export function undoDelete(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  set((s) => ({ deleting: s.deleting.filter((x) => x !== id) }));
}

/**
 * Sends one line in the open thread and streams the answer into it. Resolves when the reply is
 * stored or has failed; `onFailed` lets a mounted screen put the cursor back in the box. Another
 * thread can be opened meanwhile: the answer lands in the thread it was asked in.
 */
export async function sendLine(
  text: string,
  opts: {
    /** The server's thread key (the Chat screen knows it; the voice conversation does not). */
    fallback?: string;
    threads?: ChatThread[];
    viaVoice?: boolean;
    elevenlabs?: boolean;
    /** Read aloud by the conversation (brief, no lists): it speaks the answer itself. */
    spoken?: boolean;
    onFailed?: () => void;
  } = {},
): Promise<{ ok: true; reply: string } | { ok: false; error: string } | null> {
  const message = text.trim();
  const fallback = opts.fallback ?? serverKey;
  const base = opts.threads ?? session.threads ?? [];
  let key = currentKey(fallback);
  if (!message || session.byKey[key]?.pending) return null;
  const tempId = `pending-${Date.now()}`;
  const replyId = `${tempId}-reply`;
  setThread(key, (t) => ({
    error: null,
    draft: "",
    pending: true,
    steps: [],
    lines: [...t.lines, { id: tempId, role: "user", content: message, created_at: null }],
  }));

  // Michael's answer grows in its own bubble as it is written, then swaps for the stored pair.
  let streamed = "";
  const res = await streamChat(
    message,
    isNewKey(key) ? "new" : key,
    (piece) => {
      streamed += piece;
      const content = streamed;
      setThread(key, (t) => ({
        streamingId: replyId,
        lines: [
          ...t.lines.filter((x) => x.id !== replyId),
          { id: replyId, role: "assistant", content, created_at: null },
        ],
      }));
    },
    opts.spoken,
    (step) =>
      setThread(key, (t) => ({
        steps: t.steps.some((s) => s.id === step.id)
          ? t.steps.map((s) => (s.id === step.id ? step : s))
          : [...t.steps, step],
      })),
  );
  const temp = (x: Line) => x.id !== tempId && x.id !== replyId;
  if (res.ok) {
    const done = res.data.actions;
    const thread = res.data.thread;
    // A new chat now has its id: everything kept under the temporary key moves to it.
    if (thread && isNewKey(key)) {
      const from = key;
      key = thread.id;
      set((s) => {
        const { [from]: moved, ...rest } = s.byKey;
        return {
          // Still looking at it (the server's own new chat has no key of its own yet): follow it.
          key: (s.key ?? fallback) === from ? thread.id : s.key,
          byKey: { ...rest, [thread.id]: { ...(moved ?? EMPTY_THREAD), loaded: moved?.loaded ?? [] } },
        };
      });
    }
    setThread(key, (t) => ({
      pending: false,
      streamingId: null,
      lines: [
        ...t.lines.filter(temp),
        { ...res.data.message, key: tempId },
        { ...res.data.reply, key: replyId },
      ],
      acted: done.length ? { ...t.acted, [res.data.reply.id]: done } : t.acted,
      steps: [],
      worked: t.steps.some((s) => s.id !== "open") ? { ...t.worked, [res.data.reply.id]: t.steps } : t.worked,
    }));
    // The line under the answer survives a reload of this tab.
    keepSteps(res.data.reply.id, session.byKey[key]?.worked[res.data.reply.id] ?? []);
    if (thread) upsertThread(thread, base);
    // Michael changed the day: cached Today and Timeline must not show the old plan.
    if (done.length) window.dispatchEvent(new Event(TABS_STALE));
    // A Focus now session started in chat (#397): the session screen reads it and opens.
    if (res.data.reply.content.includes("Focusing on ")) announceFocus();
    // ...and Michael reads the changed day again before the next question (#364).
    if (done.length) warmChat(key, true);
    // Spoken once the whole answer is in: a voice reading half sentences sounds broken.
    if (opts.viaVoice) void speakReply(res.data.reply.content, opts.elevenlabs ?? false);
    return { ok: true, reply: res.data.reply.content };
  }
  // Nothing was stored: take the line back and put it in the box so it can be sent again.
  setThread(key, (t) => ({
    pending: false,
    streamingId: null,
    steps: [],
    lines: t.lines.filter(temp),
    draft: t.draft || message,
    error: res.error,
  }));
  if (opts.viaVoice) void speakReply(res.error, false);
  else opts.onFailed?.();
  return { ok: false, error: res.error };
}
