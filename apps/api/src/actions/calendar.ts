import {
  ChangeGoalPayload,
  CreateFocusBlockPayload,
  type Event,
  type Goal,
  GoalUpdate,
  MoveCalendarBlockPayload,
  MoveCalendarBlocksPayload,
  PlanChangePayload,
  type Recommendation,
  type RecommendationAction,
  RemoveCalendarBlockPayload,
} from "@michael/shared";
import { z } from "zod";
import { HttpError, parse } from "../http";
import { refusalFor } from "../instructions/guard";
import { toTimelineEvent } from "../integrations/calendar-sync";
import {
  createdByMichael,
  deleteCalendarEvent,
  type GoogleEvent,
  getCalendarEvent,
  insertCalendarEvent,
  patchCalendarEvent,
  withOthers,
} from "../integrations/google";
import { store } from "../store";
import { startFocusGuard, stopFocusGuard } from "./focus-guard";

// Michael acts on the user's own time only. Rules (Build Hub, docs/api.md):
// - never an event with other people (refused with 409, checked again against Google itself);
// - never deletes the user's events: undo deletes only a block Michael created, and moves a moved
//   block back;
// - nothing in the past, and undo only until the affected block starts.
// With Google Calendar connected the change happens in the calendar and the timeline mirrors it;
// without it, it happens on the timeline only (Michael's own blocks, source "agent").

const Times = z.object({
  start_at: z.string(),
  end_at: z.string().nullable(),
  title: z.string(),
  // Set when the move also changed the goal (#271): undo puts this one back. Absent on older rows.
  goal_id: z.string().nullable().optional(),
});

const CreateExecution = z.object({
  kind: z.literal("create_focus_block"),
  timeline_event_id: z.string().nullable(),
  google_event_id: z.string().nullable(),
  undo_until: z.string(),
});
const MoveExecution = z.object({
  kind: z.literal("move_calendar_block"),
  timeline_event_id: z.string(),
  google_event_id: z.string().nullable(),
  original: Times,
  undo_until: z.string(),
});
type MoveExecution = z.infer<typeof MoveExecution>;
// #271: the user removed one of Michael's blocks. What it was, so undo can put it back.
const RemoveExecution = z.object({
  kind: z.literal("remove_calendar_block"),
  google_event_id: z.string().nullable(),
  block: z.object({
    title: z.string(),
    start_at: z.string(),
    end_at: z.string().nullable(),
    data: z.record(z.string(), z.unknown()),
  }),
  undo_until: z.string(),
});
type RemoveExecution = z.infer<typeof RemoveExecution>;
const StepExecution = z.discriminatedUnion("kind", [CreateExecution, MoveExecution]);
type StepExecution = z.infer<typeof StepExecution>;

// Saved on the recommendation (jsonb `execution`) so undo knows exactly what to put back.
const Execution = z.discriminatedUnion("kind", [
  CreateExecution,
  MoveExecution,
  RemoveExecution,
  // Several moves carried out together (the whole day around traffic), undone together.
  z.object({
    kind: z.literal("move_calendar_blocks"),
    moves: z.array(MoveExecution).min(1),
    undo_until: z.string(),
  }),
  z.object({
    kind: z.literal("block_mac_app"),
    focus_guard_id: z.string(),
    undo_until: z.string(),
  }),
  // #188: every step of an accepted plan, in order.
  z.object({ kind: z.literal("plan_change"), steps: z.array(StepExecution), undo_until: z.string() }),
  // #188: the goals' old values, to put back on undo or when `until` passes.
  z.object({
    kind: z.literal("change_goal"),
    before: z.array(z.object({ goal_id: z.string(), patch: z.record(z.string(), z.unknown()) })),
    until: z.string().nullable(),
    undo_until: z.string(),
  }),
]);
type Execution = z.infer<typeof Execution>;

/** Without an end date, a goal change can be undone for a week. */
const GOAL_UNDO_MS = 7 * 24 * 3600_000;

const conflict = (message: string) => new HttpError("conflict", message);
const earliest = (...isos: (string | null | undefined)[]) =>
  new Date(Math.min(...isos.filter((x): x is string => Boolean(x)).map((x) => Date.parse(x)))).toISOString();

async function googleConnected(): Promise<boolean> {
  return (await store.getIntegration("google_calendar"))?.status === "connected";
}

/** Writes Google's view of an event back into the timeline mirror; returns the timeline event. */
async function mirror(g: GoogleEvent, fallbackZone = "Europe/Athens"): Promise<Event | null> {
  const input = toTimelineEvent(g, fallbackZone);
  if (!input) return null;
  const r = await store.upsertEvents([input]);
  const hit = r.inserted[0] ?? r.updated[0];
  if (hit) return hit;
  const events = await store.listEvents({
    from: input.start_at,
    to: input.end_at ?? input.start_at,
    source: ["google_calendar"],
  });
  return events.find((e) => e.external_id === g.id) ?? null;
}

const isOthers = (e: Event) => e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;
/** A block Michael created (for Michael, for the user on the Timeline, or for an agent). */
const isMichaels = (e: Event) => e.source === "agent" || e.data.michael === true;

// `step` tells apart the blocks of one plan (#188), which share a recommendation.
async function createFocusBlock(
  rec: Recommendation,
  action: RecommendationAction,
  step?: number,
): Promise<Execution> {
  const p = parse(CreateFocusBlockPayload, action.payload);
  if (Date.parse(p.start_at) <= Date.now()) throw conflict("That time has already started");
  const title = p.title ?? "Focus block";
  const undoUntil = earliest(action.undo_until, p.start_at);
  const goalId = p.goal_id ?? null;

  if (await googleConnected()) {
    const created = await insertCalendarEvent({
      summary: title,
      description: "Planned by Michael. Undo in Michael until it starts.",
      start: { dateTime: p.start_at },
      end: { dateTime: p.end_at },
      transparency: "opaque",
      reminders: { useDefault: true },
      extendedProperties: {
        private: { michael: "1", recommendation_id: rec.id, ...(goalId ? { goal_id: goalId } : {}) },
      },
    });
    const local = await mirror(created);
    return {
      kind: "create_focus_block",
      timeline_event_id: local?.id ?? null,
      google_event_id: created.id,
      undo_until: undoUntil,
    };
  }

  const { inserted } = await store.insertEvents([
    {
      source: "agent",
      type: "calendar_event",
      start_at: p.start_at,
      end_at: p.end_at,
      title,
      data: {
        michael: true,
        with_others: false,
        attendees: 0,
        recommendation_id: rec.id,
        ...(goalId ? { goal_id: goalId } : {}),
      },
      external_id: step === undefined ? `michael:${rec.id}` : `michael:${rec.id}:${step}`,
    },
  ]);
  const local = inserted[0];
  if (!local) throw conflict("I could not add the block to your timeline");
  return {
    kind: "create_focus_block",
    timeline_event_id: local.id,
    google_event_id: null,
    undo_until: undoUntil,
  };
}

async function moveCalendarBlock(action: RecommendationAction): Promise<MoveExecution> {
  return moveOne(parse(MoveCalendarBlockPayload, action.payload), action.undo_until);
}

/**
 * Every move or none: the moves run in order, and when one is refused the ones already made go
 * back before the error reaches the user.
 */
async function moveCalendarBlocks(action: RecommendationAction): Promise<Execution> {
  const { moves } = parse(MoveCalendarBlocksPayload, action.payload);
  const done: MoveExecution[] = [];
  try {
    for (const p of moves) done.push(await moveOne(p, action.undo_until));
  } catch (err) {
    for (const ex of done.reverse()) await restoreMove(ex).catch(() => null);
    throw err;
  }
  return {
    kind: "move_calendar_blocks",
    moves: done,
    undo_until: earliest(...done.map((m) => m.undo_until)),
  };
}

async function moveOne(p: MoveCalendarBlockPayload, actionUndoUntil: string | null): Promise<MoveExecution> {
  const event = await store.getEvent(p.event_id);
  if (!event) throw new HttpError("not_found", "The block to move is no longer on the timeline");
  if (event.type !== "calendar_event") throw conflict("Only calendar blocks can be moved");
  if (isOthers(event)) throw conflict("That event has other people in it. I only advise on those.");
  if (Date.parse(event.start_at) <= Date.now()) throw conflict("That block has already started");

  const length =
    (event.end_at ? Date.parse(event.end_at) : Date.parse(event.start_at)) - Date.parse(event.start_at);
  const start = p.start_at ?? event.start_at;
  const end =
    p.end_at ?? (p.start_at ? new Date(Date.parse(p.start_at) + length).toISOString() : event.end_at);
  if (Date.parse(start) <= Date.now()) throw conflict("The new time has already started");
  if (end && Date.parse(end) <= Date.parse(start)) throw conflict("The block would end before it starts");
  const goalChange = p.goal_id !== undefined;
  const oldGoal = typeof event.data.goal_id === "string" ? event.data.goal_id : null;
  const original = {
    start_at: event.start_at,
    end_at: event.end_at,
    title: event.title,
    ...(goalChange ? { goal_id: oldGoal } : {}),
  };
  const undoUntil = earliest(actionUndoUntil, event.start_at, start);

  if (event.source === "google_calendar") {
    if (!event.external_id) throw conflict("That block has no calendar id");
    const g = await getCalendarEvent(event.external_id);
    // Check Google itself: someone may have been invited since the last sync.
    if (withOthers(g)) throw conflict("That event has other people in it. I only advise on those.");
    if (g.start?.date && !g.start.dateTime) throw conflict("I do not move all day events");
    const patched = await patchCalendarEvent(g.id, {
      start: { dateTime: start, timeZone: g.start?.timeZone },
      end: { dateTime: end ?? start, timeZone: g.end?.timeZone },
      ...(p.new_title ? { summary: p.new_title } : {}),
      ...(goalChange
        ? { extendedProperties: { private: { ...g.extendedProperties?.private, goal_id: p.goal_id ?? "" } } }
        : {}),
    });
    const local = await mirror(patched);
    return {
      kind: "move_calendar_block",
      timeline_event_id: local?.id ?? event.id,
      google_event_id: g.id,
      original: { ...original, title: g.summary ?? original.title },
      undo_until: undoUntil,
    };
  }

  await store.updateEvent(event.id, {
    start_at: start,
    end_at: end,
    ...(p.new_title ? { title: p.new_title } : {}),
    ...(goalChange ? { data: withGoal(event.data, p.goal_id ?? null) } : {}),
  });
  return {
    kind: "move_calendar_block",
    timeline_event_id: event.id,
    google_event_id: null,
    original,
    undo_until: undoUntil,
  };
}

/** Puts a moved block back to its original time and title. */
async function restoreMove(ex: MoveExecution): Promise<void> {
  const o = ex.original;
  if (ex.google_event_id) {
    const g = await getCalendarEvent(ex.google_event_id);
    if (withOthers(g)) throw conflict("Someone else is on that block now. Move it in your calendar.");
    const restored = await patchCalendarEvent(g.id, {
      start: { dateTime: o.start_at, timeZone: g.start?.timeZone },
      end: { dateTime: o.end_at ?? o.start_at, timeZone: g.end?.timeZone },
      summary: o.title,
      ...(o.goal_id !== undefined
        ? { extendedProperties: { private: { ...g.extendedProperties?.private, goal_id: o.goal_id ?? "" } } }
        : {}),
    });
    await mirror(restored);
  } else {
    const event = o.goal_id !== undefined ? await store.getEvent(ex.timeline_event_id) : null;
    await store.updateEvent(ex.timeline_event_id, {
      start_at: o.start_at,
      end_at: o.end_at,
      title: o.title,
      ...(event && o.goal_id !== undefined ? { data: withGoal(event.data, o.goal_id) } : {}),
    });
  }
}

function withGoal(data: Record<string, unknown>, goalId: string | null): Record<string, unknown> {
  const { goal_id: _old, ...rest } = data;
  return goalId ? { ...rest, goal_id: goalId } : rest;
}

/**
 * #271: removes one of Michael's own blocks (never the user's events, never one with other people),
 * keeping what it was so undo can put it back until it starts.
 */
async function removeCalendarBlock(action: RecommendationAction): Promise<RemoveExecution> {
  const p = parse(RemoveCalendarBlockPayload, action.payload);
  const event = await store.getEvent(p.event_id);
  if (!event) throw new HttpError("not_found", "That block is no longer on the timeline");
  if (event.type !== "calendar_event") throw conflict("Only calendar blocks can be removed");
  if (isOthers(event)) throw conflict("That event has other people in it. I only advise on those.");
  if (!isMichaels(event)) throw conflict("I only remove blocks made in Michael. Delete it in your calendar.");
  if (Date.parse(event.start_at) <= Date.now()) throw conflict("That block has already started");
  const block = { title: event.title, start_at: event.start_at, end_at: event.end_at, data: event.data };
  const undoUntil = earliest(action.undo_until, event.start_at);

  let googleId: string | null = null;
  if (event.source === "google_calendar" && event.external_id) {
    try {
      const g = await getCalendarEvent(event.external_id);
      if (!createdByMichael(g))
        throw conflict("I only remove blocks made in Michael. Delete it in your calendar.");
      if (withOthers(g)) throw conflict("Someone else is on that block now. Remove it in your calendar.");
      await deleteCalendarEvent(g.id);
      googleId = g.id;
    } catch (err) {
      // Already gone from the calendar: only the mirror is left to remove.
      if (!(err instanceof HttpError && err.code === "not_found")) throw err;
    }
  }
  await store.deleteEvents([event.id]);
  return { kind: "remove_calendar_block", google_event_id: googleId, block, undo_until: undoUntil };
}

/** Puts a removed block back: in Google Calendar when it came from there, else on the timeline. */
async function restoreRemoved(ex: RemoveExecution): Promise<void> {
  const b = ex.block;
  const goalId = typeof b.data.goal_id === "string" ? b.data.goal_id : null;
  if (ex.google_event_id) {
    const created = await insertCalendarEvent({
      summary: b.title,
      description: "Planned in Michael. Undo in Michael until it starts.",
      start: { dateTime: b.start_at },
      end: { dateTime: b.end_at ?? b.start_at },
      transparency: "opaque",
      reminders: { useDefault: true },
      extendedProperties: { private: { michael: "1", ...(goalId ? { goal_id: goalId } : {}) } },
    });
    await mirror(created);
    return;
  }
  await store.insertEvents([
    {
      source: "agent",
      type: "calendar_event",
      start_at: b.start_at,
      end_at: b.end_at,
      title: b.title,
      data: b.data,
      external_id: `michael:restored:${crypto.randomUUID()}`,
    },
  ]);
}

export async function executeRecommendation(id: string): Promise<Recommendation> {
  return execute(id);
}

/** The user's own change on the Timeline (#271): their standing instructions are for Michael, not them. */
export async function executeUserChange(id: string): Promise<{ rec: Recommendation; execution: unknown }> {
  const rec = await execute(id, { byUser: true });
  return { rec, execution: await store.getRecommendationExecution(id) };
}

async function execute(id: string, opts: { byUser?: boolean } = {}): Promise<Recommendation> {
  const rec = await store.getRecommendation(id);
  if (!rec) throw new HttpError("not_found", "Recommendation not found");
  const action = rec.action;
  if (!action) throw conflict("This recommendation has nothing to carry out");
  if (rec.status === "done") throw conflict("Already done");
  if (rec.status === "dismissed") throw conflict("This recommendation was dismissed");
  if (action.involves_others) throw conflict("This involves other people. I only advise on it.");
  // Checked again now: an instruction added after the recommendation was made still holds.
  if (!opts.byUser) {
    const verdict = await refusalFor(action, {
      instructions: await store.listInstructions(),
      getEvent: (eventId) => store.getEvent(eventId),
    });
    if (!verdict.allowed) throw conflict(verdict.reason);
  }

  let execution: Execution;
  if (action.kind === "create_focus_block") execution = await createFocusBlock(rec, action);
  else if (action.kind === "move_calendar_block") execution = await moveCalendarBlock(action);
  else if (action.kind === "block_mac_app") execution = (await startFocusGuard(rec, action)).execution;
  else if (action.kind === "move_calendar_blocks") execution = await moveCalendarBlocks(action);
  else if (action.kind === "change_goal") execution = await executeGoalChange(action);
  else if (action.kind === "plan_change") execution = await executePlanChange(rec, action);
  else if (action.kind === "remove_calendar_block") execution = await removeCalendarBlock(action);
  else throw new HttpError("not_implemented", `${action.kind} cannot be carried out yet`);

  const saved = await store.recordRecommendationAction(id, {
    status: "done",
    executed_at: new Date().toISOString(),
    undone_at: null,
    execution,
  });
  if (!saved) throw new HttpError("not_found", "Recommendation not found");
  return saved;
}

export async function undoRecommendation(id: string): Promise<Recommendation> {
  const rec = await store.getRecommendation(id);
  if (!rec) throw new HttpError("not_found", "Recommendation not found");
  if (rec.status !== "done") throw conflict("Only a done recommendation can be undone");
  const parsed = Execution.safeParse(await store.getRecommendationExecution(id));
  if (!parsed.success) throw conflict("I have no record of what I changed, so I cannot undo it");
  const ex = parsed.data;
  if (Date.now() >= Date.parse(ex.undo_until)) {
    throw conflict(
      ex.kind === "block_mac_app"
        ? "Nothing to undo: that guard has already ended"
        : ex.kind === "change_goal"
          ? "Too late to undo: change the goal on the Goals screen"
          : "Too late to undo: the block has started",
    );
  }

  await revert(ex);

  const saved = await store.recordRecommendationAction(id, {
    status: "undone",
    undone_at: new Date().toISOString(),
  });
  if (!saved) throw new HttpError("not_found", "Recommendation not found");
  return saved;
}

/** Puts back what one execution changed. */
async function revert(ex: Execution): Promise<void> {
  if (ex.kind === "block_mac_app") {
    await stopFocusGuard(ex);
  } else if (ex.kind === "change_goal") {
    await revertGoalChange(ex);
  } else if (ex.kind === "plan_change") {
    // Last step first, so a block moved twice ends where it began.
    for (const step of [...ex.steps].reverse()) await revert(step);
  } else if (ex.kind === "create_focus_block") {
    if (ex.google_event_id) {
      try {
        const g = await getCalendarEvent(ex.google_event_id);
        // Only ever delete a block Michael created himself.
        if (!createdByMichael(g)) throw conflict("That block is not mine to remove");
        if (withOthers(g)) throw conflict("Someone else is on that block now. Remove it in your calendar.");
        await deleteCalendarEvent(g.id);
      } catch (err) {
        // Already gone from the calendar: nothing to undo there.
        if (!(err instanceof HttpError && err.code === "not_found")) throw err;
      }
    }
    if (ex.timeline_event_id) await store.deleteEvents([ex.timeline_event_id]);
  } else if (ex.kind === "remove_calendar_block") {
    await restoreRemoved(ex);
  } else if (ex.kind === "move_calendar_blocks") {
    // Check every block first, so undo puts all of them back or none.
    for (const m of ex.moves) {
      if (m.google_event_id && withOthers(await getCalendarEvent(m.google_event_id)))
        throw conflict("Someone else is on one of those blocks now. Move it in your calendar.");
    }
    for (const m of [...ex.moves].reverse()) await restoreMove(m);
  } else {
    await restoreMove(ex);
  }
}

/** Every step of a plan, each with its own guard rails; on a failure the steps done are taken back. */
async function executePlanChange(rec: Recommendation, action: RecommendationAction): Promise<Execution> {
  const p = parse(PlanChangePayload, action.payload);
  const instructions = await store.listInstructions();
  const steps: StepExecution[] = [];
  try {
    for (const [i, { kind, ...payload }] of p.steps.entries()) {
      const sub: RecommendationAction = {
        kind,
        payload,
        involves_others: false,
        undo_until: action.undo_until,
      };
      const verdict = await refusalFor(sub, { instructions, getEvent: (eventId) => store.getEvent(eventId) });
      if (!verdict.allowed) throw conflict(verdict.reason);
      const done =
        kind === "create_focus_block" ? await createFocusBlock(rec, sub, i) : await moveCalendarBlock(sub);
      steps.push(done as StepExecution);
    }
  } catch (err) {
    for (const done of steps.reverse()) await revert(done).catch(() => null);
    throw err;
  }
  return { kind: "plan_change", steps, undo_until: earliest(...steps.map((s) => s.undo_until)) };
}

/** Applies each goal change, keeping the old values so undo can put them back. */
async function executeGoalChange(action: RecommendationAction): Promise<Execution> {
  const p = parse(ChangeGoalPayload, action.payload);
  const goals = await Promise.all(p.changes.map((c) => store.getGoal(c.goal_id)));
  const missing = p.changes.find((_, i) => !goals[i]);
  if (missing) throw new HttpError("not_found", "One of those goals no longer exists");
  const before: Execution & { kind: "change_goal" } = {
    kind: "change_goal",
    before: [],
    until: p.until ?? null,
    // Temporary: undo until it ends. Otherwise a week to change your mind.
    undo_until: p.until ?? new Date(Date.now() + GOAL_UNDO_MS).toISOString(),
  };
  for (const [i, change] of p.changes.entries()) {
    const goal = goals[i] as Goal;
    const { goal_id, ...patch } = change;
    const old: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) old[key] = goal[key];
    await store.updateGoal(goal_id, patch);
    before.before.push({ goal_id, patch: old });
  }
  return before;
}

async function revertGoalChange(ex: Execution & { kind: "change_goal" }) {
  for (const b of ex.before) {
    // A goal deleted since has nothing to put back.
    await store.updateGoal(b.goal_id, parse(GoalUpdate, b.patch));
  }
}

/**
 * Temporary goal changes whose `until` has passed go back to the old values, recorded as undone.
 * The scheduler calls it per user; GET /v1/goals calls it too so the screen never shows a stale budget.
 */
export async function revertExpiredGoalChanges(now = Date.now()): Promise<number> {
  const done = (await store.listRecommendations({ status: "done" })).filter(
    (rec) => rec.action?.kind === "change_goal",
  );
  // Every execution in one wave of round trips, not one after another.
  const executions = await Promise.all(done.map((rec) => store.getRecommendationExecution(rec.id)));
  let reverted = 0;
  for (const [i, rec] of done.entries()) {
    const parsed = Execution.safeParse(executions[i]);
    if (!parsed.success || parsed.data.kind !== "change_goal" || !parsed.data.until) continue;
    if (Date.parse(parsed.data.until) > now) continue;
    await revertGoalChange(parsed.data);
    await store.recordRecommendationAction(rec.id, {
      status: "undone",
      undone_at: new Date(now).toISOString(),
    });
    reverted++;
  }
  return reverted;
}

const MIN_BLOCK_MS = 5 * 60_000;
const MAX_BLOCK_MS = 6 * 3600_000;

export interface FocusBlockRequest {
  start_at: string;
  end_at: string;
  title?: string;
  goal_id?: string | null;
  /** Who asked, for the rationale the user reads ("Claude"). */
  requested_by: string;
}

/**
 * Books a block on the user's own time straight away (an agent asked for it, over MCP). It is saved
 * as a recommendation and carried out by `executeRecommendation`, so it shows in Michael with the
 * same undo until it starts. Refuses a time that overlaps an event with other people.
 */
export async function bookFocusBlock(req: FocusBlockRequest): Promise<Recommendation> {
  const payload = parse(CreateFocusBlockPayload, {
    start_at: req.start_at,
    end_at: req.end_at,
    title: req.title,
  });
  const start = Date.parse(payload.start_at);
  const end = Date.parse(payload.end_at);
  if (start <= Date.now()) throw conflict("That time has already started");
  if (end - start < MIN_BLOCK_MS) throw new HttpError("bad_request", "A block is at least 5 minutes");
  if (end - start > MAX_BLOCK_MS) throw new HttpError("bad_request", "A block is at most 6 hours");
  if (req.goal_id && !(await store.getGoal(req.goal_id))) throw new HttpError("not_found", "Goal not found");

  const overlapping = await store.listEvents({
    from: payload.start_at,
    to: payload.end_at,
    type: ["calendar_event"],
  });
  const clash = overlapping.find(
    (e) =>
      isOthers(e) &&
      Date.parse(e.start_at) < end &&
      (e.end_at ? Date.parse(e.end_at) : Date.parse(e.start_at)) > start,
  );
  if (clash) {
    throw conflict(`That overlaps "${clash.title}", which has other people in it. Pick a free time.`);
  }

  const title = payload.title ?? "Focus block";
  const rec = await store.createRecommendation({
    goal_id: req.goal_id ?? null,
    title,
    rationale: `Booked at your request through ${req.requested_by}. Undo in Michael until it starts.`,
    action: {
      kind: "create_focus_block",
      payload: { ...payload, title },
      involves_others: false,
      undo_until: payload.start_at,
    },
    // Asked for in a conversation (with Claude), carried out straight away: same as Michael's chat.
    source: "chat",
  });
  try {
    return await executeRecommendation(rec.id);
  } catch (err) {
    // Nothing was booked: do not leave a half made suggestion behind.
    await store.updateRecommendationStatus(rec.id, "dismissed").catch(() => null);
    throw err;
  }
}

/** Until when a done recommendation can still be undone, or null when there is no record. */
export async function undoDeadline(id: string): Promise<string | null> {
  const parsed = Execution.safeParse(await store.getRecommendationExecution(id));
  return parsed.success ? parsed.data.undo_until : null;
}
