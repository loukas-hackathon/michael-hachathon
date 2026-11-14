import { type Event, type EventType, type Score, ScoreQuery } from "@michael/shared";
import { Hono } from "hono";
import { HttpError, parse } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { buildScore, isLocalDay, scoreRange } from "../score";
import { store, type TimelineFilter } from "../store";

// What the score is built from: the plan (calendar), proof of training (workouts) and the device
// events the single line of attention is made of.
const TYPES: EventType[] = ["calendar_event", "workout", "app_usage", "web_visit", "screen"];
const WEEK_MS = 7 * 24 * 3600_000;
// A store may cap the rows of one query. A page this long may have been cut short, so the reader
// asks again from the last start it saw until a page comes back shorter.
const PAGE_HINT = 1000;

const iso = (ms: number) => new Date(ms).toISOString();

type ListEvents = (filter: TimelineFilter) => Promise<Event[]>;

/**
 * Every event of the given types that overlaps [from, to], whatever the store's row cap is.
 * Pages come back sorted by start, so the next page starts at the last start seen.
 */
export async function readAllEvents(
  list: ListEvents,
  from: number,
  to: number,
  type: EventType[],
): Promise<Event[]> {
  const seen = new Map<string, Event>();
  let cursor = from;
  for (let page = 0; page < 500; page++) {
    const events = await list({ from: iso(cursor), to: iso(to), type });
    let added = 0;
    let last = cursor;
    for (const e of events) {
      if (!seen.has(e.id)) {
        seen.set(e.id, e);
        added++;
      }
      last = Math.max(last, Date.parse(e.start_at));
    }
    if (events.length < PAGE_HINT || added === 0 || last <= cursor) break;
    cursor = last;
  }
  return [...seen.values()];
}

/**
 * The one place that reads the clock and the store for a score; the functions under ../score stay
 * pure. `date` defaults to today in Europe/Athens. `now` replays a day as it stood at that instant.
 */
export async function scoreFor(query: { date?: string; now?: string }): Promise<Score> {
  const q = parse(ScoreQuery, query);
  const now = q.now ?? new Date().toISOString();
  const date = q.date ?? new Zone(DEFAULT_TIMEZONE).dayOf(Date.parse(now));
  if (!isLocalDay(date)) throw new HttpError("bad_request", "`date` must be a real day, YYYY-MM-DD");

  const range = scoreRange(date);
  // Five weeks of events, read a week at a time side by side. An event on a border comes back
  // twice and is kept once.
  const list: ListEvents = (filter) => store.listEvents(filter);
  const chunks: Promise<Event[]>[] = [];
  for (let start = range.from; start < range.to; start += WEEK_MS) {
    chunks.push(readAllEvents(list, start, Math.min(start + WEEK_MS, range.to), TYPES));
  }
  const [goals, instructions, ...pages] = await Promise.all([
    store.listGoals(),
    // The flags on the blocks are an extra: a failed read here must never take the score down.
    store.listInstructions().catch(() => []),
    ...chunks,
  ]);
  const events = new Map<string, Event>();
  for (const page of pages) for (const e of page) events.set(e.id, e);
  return buildScore([...events.values()], goals, { date, now, instructions });
}

export const score = new Hono()
  // GET /v1/score?date=YYYY-MM-DD  (default: today in Europe/Athens; `week` is the old name of `date`)
  .get("/score", async (c) => {
    const body = await scoreFor({
      date: c.req.query("date") ?? c.req.query("week"),
      now: c.req.query("now"),
    });
    return c.json(body);
  });
