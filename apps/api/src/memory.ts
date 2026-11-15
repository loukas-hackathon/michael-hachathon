import type { Event } from "@michael/shared";
import { HttpError } from "./http";
import { store } from "./store";

// What Michael and the user's agents remember across conversations: facts and preferences the user
// stated ("I train better in the morning", "school pick up is 15:00 on weekdays"). Stored as
// timeline events of type memory, so they live in the database with everything else, show on the
// user's timeline and go with "delete my data". Only memories the user gave in chat (manual) or
// through an approved agent (agent) are read back here; meeting lessons (omi) stay out, as the chat
// never sees other people's words.

const SOURCES = ["manual", "agent"] as const;
// Plenty for a hackathon week, small enough for every system prompt.
export const MEMORY_LIMIT = 40;
const MAX_TEXT = 280;
const YEAR_MS = 365 * 24 * 3600_000;

export type Memory = { id: string; text: string; at: string; from: "chat" | "agent" };

const toMemory = (e: Event): Memory => ({
  id: e.id,
  text: e.title,
  at: e.start_at,
  from: e.source === "agent" ? "agent" : "chat",
});

/** The newest memories, newest first. */
export async function listMemories(limit = MEMORY_LIMIT): Promise<Memory[]> {
  const now = Date.now();
  const events = await store.listEvents({
    from: new Date(now - YEAR_MS).toISOString(),
    to: new Date(now + 60_000).toISOString(),
    type: ["memory"],
    source: [...SOURCES],
  });
  return events.slice(-limit).reverse().map(toMemory);
}

/** Keeps one fact. The same text twice is kept once. Null when collection is off. */
export async function remember(text: string, from: "chat" | "agent"): Promise<Memory | null> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (!clean) throw new HttpError("bad_request", "Nothing to remember");
  const known = await listMemories(200);
  const same = known.find((m) => m.text.toLowerCase() === clean.toLowerCase());
  if (same) return same;
  const { inserted, ignored } = await store.insertEvents([
    {
      source: from === "agent" ? "agent" : "manual",
      type: "memory",
      start_at: new Date().toISOString(),
      end_at: null,
      title: clean,
      data: { origin: from },
      external_id: null,
    },
  ]);
  if (ignored || !inserted[0]) return null;
  return toMemory(inserted[0]);
}

/** Forgets one memory the user asked to drop. Only memories, never other records. */
export async function forget(id: string): Promise<boolean> {
  const e = await store.getEvent(id);
  if (e?.type !== "memory" || !(SOURCES as readonly string[]).includes(e.source)) return false;
  return (await store.deleteEvents([id])) > 0;
}

/** The block for a system prompt, or null when there is nothing yet. */
export function memoryContext(memories: Memory[]): string | null {
  if (!memories.length) return null;
  return `What the user told you before (keep using it; ids for forget_memory):\n${memories
    .map((m) => `- ${m.text} {memory_id ${m.id}}`)
    .join("\n")}`;
}
