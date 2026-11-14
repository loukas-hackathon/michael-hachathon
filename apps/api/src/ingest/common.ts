import { EventInput, type IngestResponse } from "@michael/shared";
import type { z } from "zod";
import { store } from "../store";

export type MappedEvent = z.input<typeof EventInput>;

// Webhook senders can post a week of data at once. The Supabase store looks up known external ids
// with one `in (...)` query per call, so insert in chunks to keep that request small.
const CHUNK = 100;

/**
 * Validates mapped events against the shared contract and stores them for the current user.
 * Privacy (source opt-in, off the record) is enforced inside `store.insertEvents`, which counts
 * dropped events in `ignored`.
 * TODO(privacy): if a shared "may this source collect right now" helper lands, call it here before
 * mapping so a disabled source is not even parsed.
 */
export async function ingest(mapped: MappedEvent[]): Promise<IngestResponse> {
  const events = mapped.map((e) => EventInput.parse(e));
  const body: IngestResponse = { inserted: 0, duplicates: 0, ignored: 0, events: [] };
  for (let i = 0; i < events.length; i += CHUNK) {
    const r = await store.insertEvents(events.slice(i, i + CHUNK));
    body.inserted += r.inserted.length;
    body.duplicates += r.duplicates;
    body.ignored += r.ignored;
    body.events.push(...r.inserted);
  }
  return body;
}

export const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** "7h15m", "42m". */
export const formatMinutes = (minutes: number) => {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};
