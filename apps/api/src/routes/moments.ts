import { IsoDateTime, type Moment, MomentKind } from "@michael/shared";
import { Hono } from "hono";
import { currentUserId } from "../context";
import { parse } from "../http";
import { computeMoment, momentRange } from "../moments/compute";
import { phraseHeadline } from "../moments/phrase";
import { DEFAULT_TIMEZONE } from "../patterns";
import { store } from "../store";

/** The one place that reads the clock and the store for a moment; ../moments/compute stays pure. */
export async function momentFor(kind: MomentKind, at?: string): Promise<Moment> {
  const now = at ?? new Date().toISOString();
  const range = momentRange(now, DEFAULT_TIMEZONE);
  const [events, goals] = await Promise.all([store.listEvents(range), store.listGoals()]);
  const core = computeMoment({ kind, events, goals, now, timezone: DEFAULT_TIMEZONE });
  const phrased = await phraseHeadline(core, `${currentUserId()}:${kind}:${core.day}`);
  return { ...core, ...phrased };
}

export const moments = new Hono()
  // GET /v1/moments/morning | /v1/moments/evening   (?at= to see the moment as of another instant)
  .get("/moments/:kind", async (c) => {
    const kind = parse(MomentKind, c.req.param("kind"));
    const at = c.req.query("at");
    return c.json(await momentFor(kind, at === undefined ? undefined : parse(IsoDateTime, at)));
  });
