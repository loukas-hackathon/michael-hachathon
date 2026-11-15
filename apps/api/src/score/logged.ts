import type { Event } from "@michael/shared";
import type { Span } from "../patterns/util";

// Done time the user reported (#317), as the score reads it. One place knows the shape of the
// manual entries that POST /v1/log, POST /v1/log/block and the chat and MCP tools write:
//
//   done   source `manual`, type `focus_session`, data { log: "done", goal_id, note?, event_id? }
//          The user did this goal from start_at to end_at. With `event_id` it settles that block
//          as "did" (Did it, all or part of it).
//   didnt  source `manual`, type `note`, data { log: "didnt", goal_id, event_id, reason? }
//          The user says the block did not happen. Its span is the block's.
//
// Both carry `recommendation_id`: the recommendation that holds the entry, so it can be undone.

export const LOG_SOURCE = "manual" as const;
export const DONE_TYPE = "focus_session" as const;
export const DIDNT_TYPE = "note" as const;

export interface LoggedDone extends Span {
  id: string;
  goalId: string;
  /** The block this entry settles as "did", if any. */
  eventId: string | null;
  note: string | null;
}

export interface Logged {
  done: LoggedDone[];
  /** Blocks the user settled as "didnt", by event id, with the reason when given. */
  didnt: Map<string, { goalId: string; reason: string | null }>;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** True for an entry this module wrote. Other manual events (memories, notes) are not logs. */
export const isLogEntry = (e: Event): boolean =>
  e.source === LOG_SOURCE && (e.data.log === "done" || e.data.log === "didnt");

/** The done entries and the "didnt" settlements among some events. Anything malformed is skipped. */
export function loggedFrom(events: Event[]): Logged {
  const done: LoggedDone[] = [];
  const didnt = new Map<string, { goalId: string; reason: string | null }>();
  for (const e of events) {
    if (!isLogEntry(e)) continue;
    const goalId = text(e.data.goal_id);
    if (!goalId) continue;
    if (e.data.log === "didnt") {
      const eventId = text(e.data.event_id);
      if (eventId) didnt.set(eventId, { goalId, reason: text(e.data.reason) });
      continue;
    }
    const start = Date.parse(e.start_at);
    const end = e.end_at ? Date.parse(e.end_at) : Number.NaN;
    if (!(end > start)) continue;
    done.push({ id: e.id, goalId, start, end, eventId: text(e.data.event_id), note: text(e.data.note) });
  }
  done.sort((a, b) => a.start - b.start);
  return { done, didnt };
}
