import { z } from "zod";
import type { MappedEvent } from "./common";

// Omi "Conversation (memory) created" webhook -> one `conversation` event.
// Format: https://docs.omi.me/doc/developer/apps/Integrations ("Memory creation triggers"). Omi
// POSTs the conversation object to the configured URL with `?uid=<omi user id>`; that uid is
// never used for anything (the caller is whoever the key belongs to).
//
// Privacy (Build Hub): keep the summary and the user's own commitments, never other speakers'
// words. So the schema reads only the structured summary and the timestamps: transcript segments,
// speaker names, app results and folders are dropped by zod before anything is stored.
// The real-time transcript webhook (a JSON array of segments) is accepted and ignored on purpose.

const SOURCE = "omi" as const;
const iso = (v: string) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export const OmiConversation = z.object({
  id: z.union([z.string().min(1), z.number()]).transform(String),
  created_at: z.string().optional(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  discarded: z.boolean().optional().catch(false),
  structured: z
    .object({
      title: z.string().optional().catch(undefined),
      overview: z.string().optional().catch(undefined),
      category: z.string().optional().catch(undefined),
      action_items: z
        .array(
          z.union([
            z.object({ description: z.string(), completed: z.boolean().optional().catch(undefined) }),
            z.string().transform((description) => ({ description, completed: undefined })),
          ]),
        )
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

/** Returns the event, or null when there is nothing to keep (discarded, empty, transcript batch). */
export function mapOmi(body: unknown): MappedEvent | null {
  if (Array.isArray(body)) return null; // real-time transcript segments: never stored
  const parsed = OmiConversation.safeParse(body);
  if (!parsed.success) return null;
  const c = parsed.data;
  if (c.discarded) return null;

  const start = iso(c.started_at ?? "") ?? iso(c.created_at ?? "");
  if (!start) return null;
  const end = iso(c.finished_at ?? "");
  const s = c.structured ?? {};
  const title =
    s.title?.trim() ||
    s.overview
      ?.trim()
      .split(/(?<=[.!?])\s/)[0]
      ?.slice(0, 120) ||
    "Conversation";
  const minutes = end ? (Date.parse(end) - Date.parse(start)) / 60_000 : null;

  return {
    source: SOURCE,
    type: "conversation",
    start_at: start,
    end_at: end && end >= start ? end : null,
    title,
    data: Object.fromEntries(
      Object.entries({
        summary: s.overview?.trim() || undefined,
        category: s.category,
        // The user's own commitments, as Omi extracted them.
        action_items: s.action_items?.map((a) => a.description.trim()).filter(Boolean) ?? [],
        action_items_done: s.action_items?.filter((a) => a.completed).length ?? 0,
        duration_min: minutes !== null && minutes > 0 ? Math.round(minutes) : undefined,
      }).filter(([, v]) => v !== undefined),
    ),
    external_id: `omi:${c.id}`,
  };
}
