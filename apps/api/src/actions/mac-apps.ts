import {
  BlockMacAppPayload,
  type Event,
  findBlockableMacApp,
  type Goal,
  type PatternReport,
  type Recommendation,
} from "@michael/shared";
import { HttpError, parse } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { goalBlocks } from "../patterns/focus";
import { Zone } from "../patterns/time";
import { patternReportFor } from "../routes/patterns";
import { type NewRecommendation, store } from "../store";
import { executeRecommendation } from "./calendar";
import { MIN_GUARD_MS, resolveApps } from "./focus-guard";

// Closing distracting Mac apps for a while: asked for straight away (chat, MCP), or suggested from
// the patterns' worst offender ("Mute WhatsApp 14:00 to 16:00, it took 47 min of focus last week").
// Both are recommendations of kind block_mac_app carried out by executeRecommendation, so Today
// shows them with the same Do it and Undo.

const zone = () => new Zone(DEFAULT_TIMEZONE);
const clock = (iso: string) => zone().clock(Date.parse(iso));
const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export interface GuardRequest {
  apps: string[];
  start_at: string;
  end_at: string;
  goal_id?: string | null;
  back_to?: string | null;
  /** Who asked, for the rationale the user reads ("Claude", "chat"). */
  requested_by: string;
  /** The line the user reads, when the app list would be too long for it (Focus now). */
  title?: string;
  /** "user" for a guard that is part of something the user started (Focus now): not listed. */
  source?: "chat" | "user";
}

/**
 * Closes the named apps on the user's Mac from start to end, straight away (asked for in chat or
 * by an agent over MCP). Saved as a recommendation (source "chat") and carried out by
 * executeRecommendation, so it can be undone in Michael until the window ends.
 */
export async function guardMacApps(req: GuardRequest): Promise<Recommendation> {
  const payload = parse(BlockMacAppPayload, {
    apps: req.apps,
    start_at: req.start_at,
    end_at: req.end_at,
    ...(req.goal_id ? { goal_id: req.goal_id } : {}),
    ...(req.back_to ? { back_to: req.back_to } : {}),
  });
  const apps = resolveApps(payload).map((a) => a.name);
  const start = Math.max(Date.parse(payload.start_at), Date.now());
  if (Date.parse(payload.end_at) - start < MIN_GUARD_MS) {
    throw new HttpError("bad_request", "A guard is at least 5 minutes, and it must end in the future");
  }
  const goal = req.goal_id ? await store.getGoal(req.goal_id).catch(() => null) : null;
  const rec = await store.createRecommendation({
    goal_id: goal?.id ?? null,
    title: req.title ?? `Mute ${list(apps)} ${clock(payload.start_at)} to ${clock(payload.end_at)}`,
    rationale: `Asked for through ${req.requested_by}. I close ${list(apps)} on your Mac when it comes to the front. Undo in Michael any time before ${clock(payload.end_at)}.`,
    action: {
      kind: "block_mac_app",
      payload: { ...payload, apps, ...(goal ? { goal_id: goal.id } : {}) },
      involves_others: false,
      undo_until: payload.end_at,
    },
    source: req.source ?? "chat",
  });
  try {
    return await executeRecommendation(rec.id);
  } catch (err) {
    // Nothing was guarded: do not leave a half made suggestion behind.
    await store.updateRecommendationStatus(rec.id, "dismissed").catch(() => null);
    throw err;
  }
}

// ---------- the worst offender, as a suggestion ----------

const MIN_WINDOW_MS = 30 * 60_000;
const FALLBACK_MS = 2 * 3600_000;
const QUARTER = 15 * 60_000;

export interface OffenderInput {
  report: Pick<PatternReport, "repeat_offenders">;
  /** Calendar events around today (any source). */
  events: Event[];
  goals: Goal[];
  now: number;
}

/**
 * Pure: the worst Mac app offender of the week, muted for the next planned work block today (or,
 * inside working hours with no block, the next two hours). Null when no blockable app stands out
 * or there is no sensible window left today.
 */
export function offenderSuggestion(input: OffenderInput): NewRecommendation | null {
  const { report, events, goals, now } = input;
  const z = zone();
  const offenders = report.repeat_offenders.data?.offenders ?? [];
  const top = offenders
    .filter((o) => o.subject.kind === "app" && o.devices.includes("mac"))
    .map((o) => ({ o, app: findBlockableMacApp(o.subject.key) ?? findBlockableMacApp(o.subject.name) }))
    .find((x) => x.app !== null);
  if (!top?.app) return null;

  const today = z.dayOf(now);
  const dayEnd = z.startOfDay(z.nextDay(today));
  const blocks = goalBlocks(events, goals, now, dayEnd).filter(
    (b) => b.goal.category === "work" && b.end - b.start >= MIN_WINDOW_MS,
  );
  const workGoal = goals.find((g) => g.active && g.category === "work") ?? null;
  let start: number;
  let end: number;
  let goal: Goal | null;
  let backTo: string | null;
  const block = blocks[0];
  if (block) {
    start = block.start;
    end = block.end;
    goal = block.goal;
    backTo = block.title;
  } else {
    const hour = z.hourOf(now);
    if (hour < 8 || hour >= 18) return null;
    start = Math.ceil(now / QUARTER) * QUARTER;
    end = Math.min(start + FALLBACK_MS, z.at(today, 19 * 60));
    if (end - start < MIN_WINDOW_MS) return null;
    goal = workGoal;
    backTo = workGoal?.title ?? null;
  }

  const name = top.app.name;
  const mins = Math.round(top.o.minutes_lost);
  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();
  return {
    goal_id: goal?.id ?? null,
    title: `Mute ${name} ${z.clock(start)} to ${z.clock(end)}`,
    rationale: `${name} broke your focus ${top.o.disruptions} times on ${top.o.days} days last week and took ${mins} min. I close it when it comes to the front, until ${z.clock(end)}.`,
    action: {
      kind: "block_mac_app",
      payload: {
        app: name,
        start_at: startIso,
        end_at: endIso,
        ...(goal ? { goal_id: goal.id } : {}),
        ...(block ? { block_event_id: block.eventId } : {}),
        ...(backTo ? { back_to: backTo.slice(0, 80) } : {}),
      },
      involves_others: false,
      undo_until: endIso,
    },
  };
}

const OPEN: ReadonlySet<Recommendation["status"]> = new Set(["proposed", "accepted", "done"]);

/**
 * Reads the week's patterns and today's plan and proposes muting the worst offender, once: an open
 * block_mac_app suggestion for the same app that has not ended yet stops a second one.
 */
export async function suggestAppGuard(now = Date.now()): Promise<Recommendation | null> {
  const z = zone();
  const today = z.dayOf(now);
  const [report, events, goals, recs] = await Promise.all([
    patternReportFor({}),
    store.listEvents({
      from: new Date(z.startOfDay(today)).toISOString(),
      to: new Date(z.startOfDay(z.nextDay(today))).toISOString(),
      type: ["calendar_event"],
    }),
    store.listGoals(),
    store.listRecommendations(),
  ]);
  const next = offenderSuggestion({ report, events, goals, now });
  if (!next?.action) return null;
  const app = next.action.payload.app;
  const already = recs.some((r) => {
    if (r.action?.kind !== "block_mac_app" || !OPEN.has(r.status)) return false;
    const p = r.action.payload;
    const names = [p.app, ...(Array.isArray(p.apps) ? p.apps : [])];
    const end = typeof p.end_at === "string" ? Date.parse(p.end_at) : 0;
    return names.includes(app) && end > now;
  });
  if (already) return null;
  return store.createRecommendation(next);
}
