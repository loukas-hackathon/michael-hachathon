import { type Event, type EventType, type Score, ScoreQuery } from "@michael/shared";
import { Hono } from "hono";
import { HttpError, parse } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { buildScore, isLocalDay, scoreRange } from "../score";
import { store } from "../store";

// What the score is built from: the plan (calendar), proof of training (workouts) and the device
// events the single line of attention is made of.
const TYPES: EventType[] = ["calendar_event", "workout", "app_usage", "web_visit", "screen"];
const WEEK_MS = 7 * 24 * 3600_000;
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
  // The store returns every row of a window, however many (#127).
  const iso = (ms: number) => new Date(ms).toISOString();
  const chunks: Promise<Event[]>[] = [];
  for (let start = range.from; start < range.to; start += WEEK_MS) {
    chunks.push(
      store.listEvents({ from: iso(start), to: iso(Math.min(start + WEEK_MS, range.to)), type: TYPES }),
    );
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
