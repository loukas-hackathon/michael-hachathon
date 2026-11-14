import { Event } from "@michael/shared";
import type { DayView } from "./day";
import { sampleDay } from "./sample/day";
import d1029 from "./sample/real/2026-10-29.json";
import p1029 from "./sample/real/2026-10-29.patterns.json";
import d1101 from "./sample/real/2026-11-01.json";
import p1101 from "./sample/real/2026-11-01.patterns.json";
import d1112 from "./sample/real/2026-11-12.json";
import p1112 from "./sample/real/2026-11-12.patterns.json";
import d1114 from "./sample/real/2026-11-14.json";
import p1114 from "./sample/real/2026-11-14.patterns.json";
import { type Block, buildTimeline, type TimelineDay } from "./timeline";

// Manolis' real days, anonymised (lib/sample/real/README.md). Used while the deployed database has
// no real data yet; the shape is exactly GET /v1/timeline, so switching to the API changes nothing here.

const Events = Event.array();
type Patterns = {
  focus_disruptions?: { status: string; data?: { longest_uninterrupted_minutes?: number } | null };
};

const REAL: Record<string, { file: unknown; patterns: Patterns }> = {
  "2026-10-29": { file: d1029, patterns: p1029 as unknown as Patterns },
  "2026-11-01": { file: d1101, patterns: p1101 as unknown as Patterns },
  "2026-11-12": { file: d1112, patterns: p1112 as unknown as Patterns },
  "2026-11-14": { file: d1114, patterns: p1114 as unknown as Patterns },
};

export const SAMPLE_DATE = sampleDay.date;
export const DEFAULT_DATE = "2026-11-12";
export const DATES_WITH_DATA = [...Object.keys(REAL), SAMPLE_DATE].sort();

/** Athens midnight for these dates (all after the October clock change, so UTC+2). */
const midnight = (date: string) => `${date}T00:00:00+02:00`;
const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export type TimelineResult = { day: TimelineDay; longestUninterrupted: number | null; label: string };

export function getTimelineDay(date: string): TimelineResult | null {
  if (date === SAMPLE_DATE)
    return { day: fromSample(sampleDay), longestUninterrupted: null, label: "Sample day" };
  const real = REAL[date];
  if (!real) return null;
  const file = real.file as { label: string; events: unknown };
  const day = buildTimeline(date, Events.parse(file.events), midnight(date), midnight(nextDay(date)));
  const fd = real.patterns.focus_disruptions;
  const longest = fd?.status === "ok" ? (fd.data?.longest_uninterrupted_minutes ?? null) : null;
  return { day, longestUninterrupted: longest, label: file.label };
}

/** The sample day as a timeline: planned blocks as outlines, filled up to now, cut by interruptions. */
function fromSample(view: DayView): TimelineDay {
  const t = (iso: string) => new Date(iso).getTime();
  const now = t(view.now);
  const blocks: Block[] = view.blocks.map((b) => {
    const start = t(b.start);
    const end = t(b.end);
    const long = b.interruptions.filter((i) => i.minutes >= 10);
    const short = b.interruptions.filter((i) => i.minutes < 10);
    return {
      start,
      end: Math.min(end, now),
      kind: "work",
      label: b.title,
      minutes: Math.max(
        0,
        (Math.min(end, now) - start) / 60_000 - b.interruptions.reduce((n, i) => n + i.minutes, 0),
      ),
      cuts: short.map((i) => ({ at: t(i.at), minutes: i.minutes, what: i.what })),
      lostStretches: long.map((i) => ({ start: t(i.at), end: t(i.at) + i.minutes * 60_000, what: i.what })),
      plan: { start, end, title: b.title },
      movedEnd: b.movedEnd ? t(b.movedEnd) : undefined,
    };
  });
  const cadence = view.lead?.evidence.kind === "cadence" ? view.lead.evidence.sessions : [];
  const phone = cadence.map((iso) => ({ start: t(iso), end: t(iso) + 90_000, title: "iPhone" }));
  const dayStart = t(`${view.date}T00:00:00+02:00`);
  const from = t(`${view.date}T08:00:00+02:00`);
  const to = t(`${view.date}T19:00:00+02:00`);
  return {
    date: view.date,
    now,
    sample: true,
    dayStart,
    dayEnd: dayStart + 86_400_000,
    blocks,
    phone,
    ai: [],
    segments: [
      { kind: "quiet", from: dayStart, to: from },
      { kind: "hours", from, to },
      { kind: "quiet", from: to, to: dayStart + 86_400_000 },
    ],
    totals: {
      workMinutes: blocks.reduce((n, b) => n + b.minutes, 0),
      lostMinutes: 47,
      phoneSessions: phone.length,
      phoneMinutes: 0,
    },
  };
}
