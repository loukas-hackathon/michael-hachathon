import type { CalendarEventData, CalendarSyncResult, EventInput } from "@michael/shared";
import type { z } from "zod";
import { Zone } from "../patterns/time";
import { store } from "../store";
import { createdByMichael, type GoogleEvent, listCalendarEvents, withOthers } from "./google";

const DAY_MS = 24 * 3600_000;
// Today plus and minus a week: enough for the week view and for Michael to plan ahead.
export const SYNC_DAYS = 7;
const DEFAULT_ZONE = "Europe/Athens";

/** Midnight of a calendar date ("2026-11-14") in a zone, as an instant. */
function localMidnight(date: string, zone: Zone): string {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  // Two passes settle the offset on daylight saving change days.
  let ms = wall - zone.offsetAt(wall);
  ms = wall - zone.offsetAt(ms);
  return new Date(ms).toISOString();
}

/**
 * One Google event as a timeline event, or null when it is not part of the user's day (cancelled,
 * declined, or without times). `external_id` is Google's event id, so syncing twice is a no-op.
 */
export function toTimelineEvent(e: GoogleEvent, zoneName: string): z.output<typeof EventInput> | null {
  if (e.status === "cancelled") return null;
  const me = e.attendees?.find((a) => a.self);
  if (me?.responseStatus === "declined") return null;
  let zone: Zone;
  try {
    zone = new Zone(zoneName);
  } catch {
    zone = new Zone(DEFAULT_ZONE);
  }
  const allDay = Boolean(e.start?.date && !e.start.dateTime);
  const start = e.start?.dateTime ?? (e.start?.date ? localMidnight(e.start.date, zone) : null);
  const end = e.end?.dateTime ?? (e.end?.date ? localMidnight(e.end.date, zone) : null);
  if (!start) return null;
  const startIso = new Date(start).toISOString();
  const endIso = end && Date.parse(end) >= Date.parse(start) ? new Date(end).toISOString() : null;

  const data: CalendarEventData = {
    calendar: "primary",
    status: e.status ?? "confirmed",
    all_day: allDay,
    attendees: (e.attendees ?? []).filter((a) => !a.resource).length,
    with_others: withOthers(e),
    organizer_self: e.organizer ? e.organizer.self === true : true,
    michael: createdByMichael(e),
    transparency: e.transparency ?? "opaque",
    recurring: Boolean(e.recurringEventId),
    location: e.location ?? null,
    html_link: e.htmlLink ?? null,
    updated: e.updated ?? null,
  };
  return {
    source: "google_calendar",
    type: "calendar_event",
    start_at: startIso,
    end_at: endIso,
    title: e.summary?.trim() || "Busy",
    data,
    external_id: e.id,
  };
}

/**
 * Mirrors the current user's primary Google calendar (today +/- 7 days) into the timeline.
 * Idempotent: events are upserted by Google id, and mirrored events that disappeared from Google in
 * the window are removed from the mirror (the calendar itself is never touched here).
 */
export async function syncGoogleCalendar(now = Date.now()): Promise<CalendarSyncResult> {
  const from = new Date(now - SYNC_DAYS * DAY_MS).toISOString();
  const to = new Date(now + SYNC_DAYS * DAY_MS).toISOString();
  try {
    const page = await listCalendarEvents(from, to);
    const zone = page.timeZone ?? DEFAULT_ZONE;
    const inputs = page.events
      .map((e) => toTimelineEvent(e, zone))
      .filter((e): e is NonNullable<typeof e> => e !== null);
    const { inserted, updated, unchanged } = await store.upsertEvents(inputs);

    const keep = new Set(inputs.map((i) => i.external_id));
    const mirrored = await store.listEvents({ from, to, source: ["google_calendar"] });
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    const gone = mirrored.filter((e) => {
      const start = Date.parse(e.start_at);
      return e.external_id && !keep.has(e.external_id) && start >= fromMs && start <= toMs;
    });
    const removed = await store.deleteEvents(gone.map((e) => e.id));

    const lastSync = new Date().toISOString();
    const rec = await store.getIntegration("google_calendar");
    await store.saveIntegration("google_calendar", {
      status: "connected",
      error: null,
      last_sync_at: lastSync,
      // The ID token's address wins; the primary calendar's name (also the address) is the fallback.
      ...(!rec?.account && page.summary ? { account: page.summary } : {}),
    });
    return {
      from,
      to,
      fetched: page.events.length,
      inserted: inserted.length,
      updated: updated.length,
      unchanged,
      removed,
      last_sync_at: lastSync,
    };
  } catch (err) {
    const rec = await store.getIntegration("google_calendar");
    if (rec?.status === "connected") {
      await store.saveIntegration("google_calendar", {
        error: err instanceof Error ? err.message : "Calendar sync failed",
      });
    }
    throw err;
  }
}
