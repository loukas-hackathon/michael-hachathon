import { type Event, IsoDateTime, type Moment, MomentKind } from "@michael/shared";
import { Hono } from "hono";
import { currentUserId } from "../context";
import { parse } from "../http";
import { allowedMove } from "../instructions/guard";
import { memo } from "../memo";
import { computeMoment, type MomentCore, momentRange } from "../moments/compute";
import { phraseHeadline } from "../moments/phrase";
import { DEFAULT_TIMEZONE } from "../patterns";
import { store } from "../store";
import { TYPES } from "./score";

const WEEK_MS = 7 * 24 * 3600_000;
const MOMENT_MEMO_MS = 20_000;

/** The one place that reads the store for a moment; ../moments/compute stays pure. No model. */
export async function momentCoreFor(kind: MomentKind, now: string): Promise<MomentCore> {
  // The moment's numbers are the score's, so it reads what the score reads (routes/score.ts): the
  // same event types over the same weeks, a week at a time side by side. An event on a border
  // comes back twice and is kept once.
  const range = momentRange(now, DEFAULT_TIMEZONE);
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const iso = (ms: number) => new Date(ms).toISOString();
  const chunks: Promise<Event[]>[] = [];
  for (let start = from; start < to; start += WEEK_MS) {
    chunks.push(store.listEvents({ from: iso(start), to: iso(Math.min(start + WEEK_MS, to)), type: TYPES }));
  }
  const [goals, instructions, ...pages] = await Promise.all([
    store.listGoals(),
    store.listInstructions(),
    ...chunks,
  ]);
  const byId = new Map<string, Event>();
  for (const page of pages) for (const e of page) byId.set(e.id, e);
  const events = [...byId.values()];
  const core = computeMoment({ kind, events, goals, now, timezone: DEFAULT_TIMEZONE });
  // Standing instructions (instructions/guard.ts): a move into protected time is not offered.
  const ok = (m: MomentCore["first_move"]) => !m || allowedMove(m, instructions, DEFAULT_TIMEZONE);
  return {
    ...core,
    suggestions: core.suggestions.filter(ok),
    first_move: ok(core.first_move) ? core.first_move : null,
  };
}

/**
 * The moment with its headline (phrased by the model when it can). `wait: false` never waits for
 * the model: Today shows the template or a cached line at once and asks again for the model's
 * (`phrase_pending`, #378).
 */
export async function momentFor(kind: MomentKind, at?: string, { wait = true } = {}): Promise<Moment> {
  // At the real clock the numbers are reused for a few seconds until the user writes (memo.ts,
  // #298); a moment seen as of another instant (`at`) is always computed.
  const core =
    at === undefined
      ? await memo("moment", { kind }, MOMENT_MEMO_MS, () => momentCoreFor(kind, new Date().toISOString()))
      : await momentCoreFor(kind, at);
  const phrased = await phraseHeadline(core, `${currentUserId()}:${kind}:${core.day}`, undefined, { wait });
  return { ...core, ...phrased };
}

export const moments = new Hono()
  // GET /v1/moments/morning | /v1/moments/evening   (?at= to see the moment as of another instant;
  // ?phrase=cached never waits for the model)
  .get("/moments/:kind", async (c) => {
    const kind = parse(MomentKind, c.req.param("kind"));
    const at = c.req.query("at");
    const wait = c.req.query("phrase") !== "cached";
    return c.json(await momentFor(kind, at === undefined ? undefined : parse(IsoDateTime, at), { wait }));
  });
