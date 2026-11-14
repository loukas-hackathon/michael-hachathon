import {
  type AreaTargets,
  type GoalArea,
  type RecordsResponse,
  TargetQuery,
  type TargetResponse,
  TargetUpdate,
  type WeeklyTarget,
} from "@michael/shared";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError, jsonBody, parse } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { currentRecords, isLocalDay } from "../score";
import { DEFAULT_FLOORS, timeAreasOf } from "../score/targets";
import { store } from "../store";
import { loadWeek, syncRecords, targetState } from "./score";

// Weekly targets (#165) and personal records (#166). The rules are pure, in score/targets.ts and
// score/records.ts; this file reads the store and the clock.

const zone = new Zone(DEFAULT_TIMEZONE);

/** The Monday of the week that holds a local day. */
function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return zone.nextDay(day, -((weekday + 6) % 7));
}

/** GET /v1/targets/current: the week's target (stored, or Michael's proposal) and the baseline. */
export async function targetFor(query: { week?: string; now?: string }): Promise<TargetResponse> {
  const q = parse(TargetQuery, query);
  const now = q.now ?? new Date().toISOString();
  const day = q.week ?? zone.dayOf(Date.parse(now));
  if (!isLocalDay(day)) throw new HttpError("bad_request", "`week` must be a real day, YYYY-MM-DD");
  const week = await loadWeek({ date: mondayOf(day), now });
  const { target, baseline } = await targetState(week);
  return { target, baseline };
}

/**
 * PUT /v1/targets/:week_start. `accept` alone keeps Michael's proposal (set_by "michael"); any
 * number makes it the user's (set_by "user"). Either way it is stored as accepted.
 */
export async function setTarget(weekStart: string, body: unknown): Promise<WeeklyTarget> {
  if (!isLocalDay(weekStart) || mondayOf(weekStart) !== weekStart) {
    throw new HttpError("bad_request", "`week_start` must be a Monday, YYYY-MM-DD");
  }
  const u = parse(TargetUpdate, body);
  const week = await loadWeek({ date: weekStart, now: new Date().toISOString() });
  const { stored, proposal, baseline } = await targetState(week);
  const base = stored ?? proposal;
  const numbers = u.overall_pct !== undefined || u.areas !== undefined || u.floors !== undefined;

  if (!numbers) {
    if (!base) {
      throw new HttpError(
        "conflict",
        `No proposal to accept yet. ${baseline.reason ?? ""} Send your own numbers instead.`.trim(),
      );
    }
    return store.saveTarget({ ...base, week_start: weekStart, status: "accepted" });
  }

  const overall = u.overall_pct ?? base?.overall_pct;
  if (overall === undefined) {
    throw new HttpError("bad_request", "`overall_pct` is needed while there is no proposal for the week");
  }
  const defined = <T extends object>(o: T | undefined) =>
    Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
  // Without a proposal, each category with time goals starts at the overall number.
  const timeAreas = timeAreasOf(week.score);
  const start = (a: GoalArea) => (timeAreas.has(a) ? overall : null);
  const areas: AreaTargets = {
    ...(base?.areas ?? { business: start("business"), health: start("health"), personal: start("personal") }),
    ...defined(u.areas),
  };
  const floors = { ...(base?.floors ?? DEFAULT_FLOORS), ...defined(u.floors) };
  return store.saveTarget({
    week_start: weekStart,
    overall_pct: overall,
    areas,
    floors,
    status: "accepted",
    set_by: "user",
    reason: proposal ? `You set ${overall}%. I proposed ${proposal.overall_pct}%.` : `You set ${overall}%.`,
    basis: base?.basis ?? {
      weeks_used: Math.min(4, baseline.full_weeks),
      median_pct: null,
      step: null,
      on_target_weeks: 0,
      heavy_week: false,
    },
  });
}

/** GET /v1/records: the current best of each kind and scope, plus any not yet announced. */
export async function recordsFor(): Promise<RecordsResponse> {
  const week = await loadWeek({});
  return { records: currentRecords(await syncRecords(week)) };
}

export const targets = new Hono()
  .get("/targets/current", async (c) =>
    c.json(await targetFor({ week: c.req.query("week"), now: c.req.query("now") })),
  )
  .put("/targets/:week_start", async (c) =>
    c.json(await setTarget(c.req.param("week_start"), await jsonBody(c))),
  )
  .get("/records", async (c) => c.json(await recordsFor()))
  // The nudge engine marks a record once it went out, so it is announced once.
  .post("/records/:id/announced", async (c) => {
    const id = parse(z.uuid(), c.req.param("id"));
    const record = await store.markRecordAnnounced(id);
    if (!record) throw new HttpError("not_found", "Record not found");
    return c.json(record);
  });
