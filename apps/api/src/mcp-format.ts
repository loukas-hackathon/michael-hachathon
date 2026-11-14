import { z } from "zod";
import { DEFAULT_TIMEZONE } from "./patterns";
import { Zone } from "./patterns/time";

// Helpers for MCP tool replies: short, human readable text in the user's local time (24 hour,
// Europe/Athens), next to the structured result. Models read the text first, so it carries the
// numbers that matter and the ids needed for the next call.

export const zone = new Zone(DEFAULT_TIMEZONE);

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Sat 14 Nov". */
export const dayLabel = (ms: number) => dayFormat.format(ms).replace(",", "");

/** "Sat 14 Nov 15:00". */
export const when = (iso: string) => {
  const ms = Date.parse(iso);
  return `${dayLabel(ms)} ${zone.clock(ms)}`;
};

/** "Sat 14 Nov 15:00 to 16:30"; the end carries its own day when it falls on another one. */
export function span(start: string, end: string | null | undefined): string {
  if (!end) return when(start);
  const a = Date.parse(start);
  const b = Date.parse(end);
  return zone.dayOf(a) === zone.dayOf(b)
    ? `${when(start)} to ${zone.clock(b)}`
    : `${when(start)} to ${when(end)}`;
}

/** "2h 05m", "45m", "0m". */
export function dur(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes ?? 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, "0")}m` : `${h}h`;
}

export const pct = (v: number | null | undefined) => (v == null ? "no score yet" : `${Math.round(v)}%`);

const LOCAL_OR_OFFSET = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** A time a model can write either way: local wall time in Europe/Athens, or ISO 8601 with an offset. */
export const TimeInput = z
  .string()
  .regex(LOCAL_OR_OFFSET, "Use YYYY-MM-DDTHH:MM (Europe/Athens local time) or ISO 8601 with an offset");

/** The instant for a TimeInput, as ISO 8601 UTC. A time without an offset is Europe/Athens wall time. */
export function toInstant(input: string): string {
  const m = LOCAL_OR_OFFSET.exec(input);
  if (!m) throw new Error(`Not a time: ${input}`);
  if (m[5]) return new Date(Date.parse(input)).toISOString();
  const [, day, hh, mm, ss] = m;
  const ms = zone.at(day as string, Number(hh) * 60 + Number(mm)) + Number(ss ?? 0) * 1000;
  return new Date(ms).toISOString();
}

export const LocalDayInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Local day in Europe/Athens, YYYY-MM-DD");

/** A tool result: compact text for the model plus the same facts as structured content. */
export function reply(text: string, structured: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: structured,
  };
}

export function failure(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}
