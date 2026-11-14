import { IsoDateTime, type Moment, MomentKind } from "@michael/shared";
import { Hono } from "hono";
import { currentUserId } from "../context";
import { parse } from "../http";
import { computeMoment, type MomentCore, momentRange } from "../moments/compute";
import { phraseHeadline } from "../moments/phrase";
import { DEFAULT_TIMEZONE } from "../patterns";
import { store } from "../store";

/** The one place that reads the store for a moment; ../moments/compute stays pure. No model. */
export async function momentCoreFor(kind: MomentKind, now: string): Promise<MomentCore> {
  const range = momentRange(now, DEFAULT_TIMEZONE);
  const [events, goals] = await Promise.all([store.listEvents(range), store.listGoals()]);
  return computeMoment({ kind, events, goals, now, timezone: DEFAULT_TIMEZONE });
}

/** The moment with its headline (phrased by the model when it can). */
export async function momentFor(kind: MomentKind, at?: string): Promise<Moment> {
  const core = await momentCoreFor(kind, at ?? new Date().toISOString());
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
