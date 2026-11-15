import { type Event, IsoDateTime, type PatternReport, PatternsQuery } from "@michael/shared";
import { Hono } from "hono";
import { HttpError, parse } from "../http";
import { memo } from "../memo";
import { buildPatternReport } from "../patterns";
import { store } from "../store";

const DAY_MS = 24 * 3600_000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 92;
// Sleep and recovery just after the range are needed for "the morning after" the last night.
const LOOKAHEAD_MS = 18 * 3600_000;

/**
 * The one place that reads the clock and the store for a pattern report; the detectors under
 * ../patterns stay pure. Defaults to the 7 days ending now.
 */
export function patternReportFor(range: { from?: string; to?: string }): Promise<PatternReport> {
  // The same report is reused for a minute until the user writes (memo.ts, #298). A window that
  // ends "now" (no `to`) is one entry however the clock moves within that minute.
  return memo("patterns", { from: range.from ?? null, to: range.to ?? null }, PATTERNS_MEMO_MS, () =>
    computePatternReport(range),
  );
}

const PATTERNS_MEMO_MS = 60_000;

async function computePatternReport(range: { from?: string; to?: string }): Promise<PatternReport> {
  const now = new Date().toISOString();
  const to = parse(IsoDateTime, range.to ?? now);
  const from = parse(
    IsoDateTime,
    range.from ?? new Date(Date.parse(to) - DEFAULT_DAYS * DAY_MS).toISOString(),
  );
  const q = parse(PatternsQuery, { from, to });
  const span = Date.parse(q.to) - Date.parse(q.from);
  if (!(span > 0)) throw new HttpError("bad_request", "`to` must be after `from`");
  if (span > MAX_DAYS * DAY_MS) throw new HttpError("bad_request", `Range is limited to ${MAX_DAYS} days`);

  const [events, goals] = await Promise.all([
    eventsByDay(Date.parse(q.from), Date.parse(q.to) + LOOKAHEAD_MS),
    store.listGoals(),
  ]);
  return buildPatternReport(events, { from: q.from, to: q.to, now, goals });
}

/**
 * Every event of the window, read a day at a time side by side (#364). A week of app and web
 * activity is thousands of rows, and one read pages through them one round trip after another
 * (about 800 ms for the chat's week); days in parallel take about as long as the busiest day.
 * An event on a border comes back twice and is kept once; the order is the store's (start, id).
 */
export async function eventsByDay(from: number, to: number): Promise<Event[]> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const chunks: Promise<Event[]>[] = [];
  // A week at a time for long ranges, so a 92 day report is 14 reads, not 92.
  const step = to - from > 14 * DAY_MS ? 7 * DAY_MS : DAY_MS;
  for (let start = from; start < to; start += step) {
    chunks.push(store.listEvents({ from: iso(start), to: iso(Math.min(start + step, to)) }));
  }
  const byId = new Map<string, Event>();
  for (const page of await Promise.all(chunks)) for (const e of page) byId.set(e.id, e);
  return [...byId.values()].sort(
    (a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export const patterns = new Hono()
  // GET /v1/patterns?from=&to=  (default: the 7 days ending now)
  .get("/patterns", async (c) => {
    const body = await patternReportFor({ from: c.req.query("from"), to: c.req.query("to") });
    return c.json(body);
  });
