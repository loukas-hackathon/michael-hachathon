import { BlockChange, BlockCreate, BlockUpdate, type RecommendationAction } from "@michael/shared";
import { Hono } from "hono";
import { z } from "zod";
import { executeUserChange } from "../actions/calendar";
import { HttpError, jsonBody, parse } from "../http";
import { store } from "../store";

// #271: the user edits their own day on the Timeline: add a block, move or resize it, rename it,
// give it a goal, or remove one of their own (#457: made in Michael or a solo calendar event). Each change is stored as a recommendation with
// source "user" and carried out at once by the same executor as Michael's own actions
// (actions/calendar.ts), so every guard rail holds (never events with other people, never the past,
// removing only the user's own events, with undo) and POST /v1/recommendations/:id/undo takes it back until
// the block starts. Google Calendar gets the change when it is connected; otherwise the timeline.

const Id = z.uuid();
const iso = (ms: number) => new Date(ms).toISOString();
const time = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

async function change(
  goalId: string | null,
  title: string,
  action: RecommendationAction,
): Promise<BlockChange> {
  const rec = await store.createRecommendation({
    goal_id: goalId,
    title,
    rationale: "You changed this on the Timeline.",
    action,
    source: "user",
  });
  try {
    const { execution } = await executeUserChange(rec.id);
    const ex = (execution ?? {}) as { timeline_event_id?: string | null; undo_until?: string };
    const event = ex.timeline_event_id ? await store.getEvent(ex.timeline_event_id) : null;
    return BlockChange.parse({
      event,
      recommendation_id: rec.id,
      undo_until: ex.undo_until ?? action.undo_until,
    });
  } catch (err) {
    // Nothing changed: do not leave a half made record behind.
    await store.updateRecommendationStatus(rec.id, "dismissed").catch(() => null);
    throw err;
  }
}

export const blocks = new Hono()
  .post("/blocks", async (c) => {
    const p = parse(BlockCreate, await jsonBody(c));
    const length = Date.parse(p.end_at) - Date.parse(p.start_at);
    if (length < 5 * 60_000) throw new HttpError("bad_request", "A block is at least 5 minutes");
    if (length > 12 * 3600_000) throw new HttpError("bad_request", "A block is at most 12 hours");
    if (p.goal_id && !(await store.getGoal(p.goal_id))) throw new HttpError("not_found", "Goal not found");
    const title = p.title ?? "New block";
    const result = await change(p.goal_id ?? null, `Added ${title} at ${time(p.start_at)}`, {
      kind: "create_focus_block",
      payload: { start_at: p.start_at, end_at: p.end_at, title, goal_id: p.goal_id ?? null },
      involves_others: false,
      undo_until: p.start_at,
    });
    return c.json(result, 201);
  })
  .patch("/blocks/:id", async (c) => {
    const id = parse(Id, c.req.param("id"));
    const p = parse(BlockUpdate, await jsonBody(c));
    const event = await store.getEvent(id);
    if (!event) throw new HttpError("not_found", "That block is no longer on the timeline");
    if (p.goal_id && !(await store.getGoal(p.goal_id))) throw new HttpError("not_found", "Goal not found");
    // As the executor does it: a new start keeps the length unless an end is given.
    const length =
      (event.end_at ? Date.parse(event.end_at) : Date.parse(event.start_at)) - Date.parse(event.start_at);
    const start = p.start_at ?? event.start_at;
    const end = p.end_at ?? (p.start_at ? iso(Date.parse(p.start_at) + length) : event.end_at);
    if (end && Date.parse(end) - Date.parse(start) < 5 * 60_000 && (p.start_at || p.end_at))
      throw new HttpError("bad_request", "A block is at least 5 minutes");
    const moved = p.start_at && p.start_at !== event.start_at;
    const title = moved
      ? `Moved ${event.title} to ${time(start)}`
      : p.start_at || p.end_at
        ? `Changed ${event.title} to ${time(start)}`
        : `Changed ${event.title}`;
    const result = await change(p.goal_id ?? null, title, {
      kind: "move_calendar_block",
      payload: {
        event_id: id,
        ...(p.start_at ? { start_at: p.start_at } : {}),
        ...(p.end_at ? { end_at: p.end_at } : {}),
        ...(p.title && p.title !== event.title ? { new_title: p.title } : {}),
        ...(p.goal_id !== undefined ? { goal_id: p.goal_id } : {}),
      },
      involves_others: false,
      undo_until: event.start_at,
    });
    return c.json(result);
  })
  .delete("/blocks/:id", async (c) => {
    const id = parse(Id, c.req.param("id"));
    const event = await store.getEvent(id);
    if (!event) throw new HttpError("not_found", "That block is no longer on the timeline");
    const result = await change(null, `Removed ${event.title}`, {
      kind: "remove_calendar_block",
      payload: { event_id: id },
      involves_others: false,
      undo_until: event.start_at,
    });
    return c.json(result);
  });
