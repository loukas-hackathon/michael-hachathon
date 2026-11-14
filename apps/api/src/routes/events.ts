import {
  EventBatchInput,
  EventInput,
  type IngestResponse,
  TimelineQuery,
  type TimelineResponse,
} from "@michael/shared";
import { Hono } from "hono";
import { jsonBody, parse } from "../http";
import { store } from "../store";

const list = (v: string | undefined) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

export const events = new Hono()
  // GET /v1/timeline?from=&to=&source=a,b&type=x,y  (defaults: last 24h)
  .get("/timeline", async (c) => {
    const to = c.req.query("to") ?? new Date().toISOString();
    const from = c.req.query("from") ?? new Date(Date.parse(to) - 24 * 3600_000).toISOString();
    const q = parse(TimelineQuery, {
      from,
      to,
      source: list(c.req.query("source")),
      type: list(c.req.query("type")),
    });
    const body: TimelineResponse = { from: q.from, to: q.to, events: await store.listEvents(q) };
    return c.json(body);
  })
  .post("/events", async (c) => {
    const input = parse(EventInput, await jsonBody(c));
    const { inserted, duplicates } = await store.insertEvents([input]);
    const body: IngestResponse = { inserted: inserted.length, duplicates, events: inserted };
    return c.json(body, 201);
  })
  .post("/events/batch", async (c) => {
    const input = parse(EventBatchInput, await jsonBody(c));
    const { inserted, duplicates } = await store.insertEvents(input.events);
    const body: IngestResponse = { inserted: inserted.length, duplicates, events: inserted };
    return c.json(body, 201);
  });
