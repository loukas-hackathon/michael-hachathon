import { RitualEveningInput, RitualKind, RitualMorningInput, RitualQuery } from "@michael/shared";
import { Hono } from "hono";
import { jsonBody, parse } from "../http";
import { logEvening, planMorning, ritualFor, skipRitual } from "../ritual/ritual";

// The daily ritual (#318): the morning plan and the evening log. Rules in ritual/ritual.ts.
export const ritual = new Hono()
  // GET /v1/ritual?phase=morning|evening (phase: show that half now, for a preview or the stage)
  .get("/ritual", async (c) => {
    const q = parse(RitualQuery, { phase: c.req.query("phase") || undefined });
    return c.json(await ritualFor(Date.now(), { phase: q.phase }));
  })
  .post("/ritual/morning", async (c) => {
    const input = parse(RitualMorningInput, await jsonBody(c));
    return c.json(await planMorning(input), 201);
  })
  .post("/ritual/evening", async (c) => {
    const input = parse(RitualEveningInput, await jsonBody(c));
    return c.json(await logEvening(input), 201);
  })
  // "Not today": that half stays hidden for the rest of the day.
  .post("/ritual/:kind/skip", async (c) => {
    const kind = parse(RitualKind, c.req.param("kind"));
    return c.json(await skipRitual(kind));
  });
