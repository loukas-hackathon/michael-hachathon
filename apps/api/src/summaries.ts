import { categoriseEvent, type Event, type EventSummary, RETENTION_DAYS } from "@michael/shared";

// Pure helpers of the retention job (retention.ts): what an old event becomes in event_summaries.

const DAY_MS = 24 * 3600_000;

/** Start of the UTC day RETENTION_DAYS before `now`: events that started before it are rolled up. */
export const retentionCutoff = (now: number, days = RETENTION_DAYS): string =>
  new Date(Math.floor((now - days * DAY_MS) / DAY_MS) * DAY_MS).toISOString();

const str = (v: unknown) => (typeof v === "string" && v.length ? v : null);

/**
 * The category of an event's app or site (the shared categoriser), else the category the event
 * carries itself, else "". Never guesses from a title.
 */
export function eventCategory(e: Pick<Event, "data"> & Partial<Pick<Event, "type" | "title">>): string {
  const known = categoriseEvent(e);
  if (known) return known;
  const own = str(e.data?.category);
  return own ? own.slice(0, 40) : "";
}

/** Seconds an event covers: end minus start, else the `seconds` it reports, else 0. */
export function eventSeconds(e: Pick<Event, "start_at" | "end_at" | "data">): number {
  if (e.end_at) return Math.max(0, Math.round((Date.parse(e.end_at) - Date.parse(e.start_at)) / 1000));
  const s = e.data?.seconds;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? Math.round(s) : 0;
}

export const summaryKey = (s: Pick<EventSummary, "day" | "source" | "type" | "category">) =>
  `${s.day}|${s.source}|${s.type}|${s.category}`;

/** Pure: daily totals per UTC day, source, type and category, sorted by day then key. */
export function summariseEvents(
  events: (Pick<Event, "source" | "type" | "start_at" | "end_at" | "data"> & Partial<Pick<Event, "title">>)[],
) {
  const out = new Map<string, EventSummary>();
  for (const e of events) {
    const row: EventSummary = {
      day: new Date(e.start_at).toISOString().slice(0, 10),
      source: e.source,
      type: e.type,
      category: eventCategory(e),
      events: 1,
      seconds: eventSeconds(e),
    };
    const k = summaryKey(row);
    const hit = out.get(k);
    if (hit) {
      hit.events += 1;
      hit.seconds += row.seconds;
    } else out.set(k, row);
  }
  return [...out.values()].sort((a, b) => summaryKey(a).localeCompare(summaryKey(b)));
}

/** Pure: adds `fresh` totals onto `existing` rows with the same key (a day can be rolled up twice). */
export function mergeSummaries(existing: EventSummary[], fresh: EventSummary[]): EventSummary[] {
  const byKey = new Map(existing.map((s) => [summaryKey(s), { ...s }]));
  return fresh.map((f) => {
    const old = byKey.get(summaryKey(f));
    return old ? { ...f, events: old.events + f.events, seconds: old.seconds + f.seconds } : f;
  });
}
