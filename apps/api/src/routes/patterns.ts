import { IsoDateTime, type PatternReport, PatternsQuery } from "@michael/shared";
import { Hono } from "hono";
import { HttpError, parse } from "../http";
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
export async function patternReportFor(range: { from?: string; to?: string }): Promise<PatternReport> {
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
    store.listEvents({ from: q.from, to: new Date(Date.parse(q.to) + LOOKAHEAD_MS).toISOString() }),
    store.listGoals(),
  ]);
  return buildPatternReport(events, { from: q.from, to: q.to, now, goals });
}

export const patterns = new Hono()
  // GET /v1/patterns?from=&to=  (default: the 7 days ending now)
  .get("/patterns", async (c) => {
    const body = await patternReportFor({ from: c.req.query("from"), to: c.req.query("to") });
    return c.json(body);
  });
