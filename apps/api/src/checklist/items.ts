import {
  CHECKLIST_MAX_OPEN,
  type ChecklistCarryResponse,
  type ChecklistItem,
  type ChecklistItemCreate,
  type ChecklistItemUpdate,
  type ChecklistResponse,
  type ChecklistSettledBy,
  type Goal,
  goalKind,
} from "@michael/shared";
import { z } from "zod";
import { HttpError } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { Zone } from "../patterns/time";
import { type ChecklistPatch, store } from "../store";

// The day's outcomes of a checklist goal (#238): the rules on top of the store, shared by the
// routes, the MCP tools and the evening check in (#187).
//
//   - Items belong to a goal of kind `checklist`; any other goal is a 400.
//   - At most three open items per goal and day (409). An item takes the lowest free slot
//     (`position` 0..2) among the open ones.
//   - Michael never ticks an item. The user settles it (done, partly or dropped, `settled_by: "user"`),
//     or the check in does (`settled_by: "check_in"`). Reopening clears both.
//   - Carrying moves an open item to the next day: the old one becomes `moved`, a new one
//     continues it with `carried_from`. `moved` is never set by hand.

export const zone = new Zone(DEFAULT_TIMEZONE);

/** Today in Europe/Athens. */
export const todayOf = (now = Date.now()) => zone.dayOf(now);

const conflict = (message: string) => new HttpError("conflict", message);
const notFound = () => new HttpError("not_found", "Checklist item not found");

/** The item, or 404 (also for an id that is not a uuid, which no item has). */
async function itemOf(id: string): Promise<ChecklistItem> {
  const item = z.uuid().safeParse(id).success ? await store.getChecklistItem(id) : null;
  if (!item) throw notFound();
  return item;
}

async function checklistGoal(id: string): Promise<Goal> {
  const goal = await store.getGoal(id);
  if (!goal) throw new HttpError("not_found", "Goal not found");
  if (goalKind(goal) !== "checklist") {
    throw new HttpError("bad_request", "That goal is not a checklist goal (target.kind must be checklist)");
  }
  return goal;
}

/** The lowest slot no open item of the goal holds on that day, or null when all three are taken. */
export function freePosition(items: ChecklistItem[], goalId: string, date: string): number | null {
  const used = new Set(
    items
      .filter((i) => i.goal_id === goalId && i.date === date && i.status === "open")
      .map((i) => i.position),
  );
  for (let p = 0; p < CHECKLIST_MAX_OPEN; p++) if (!used.has(p)) return p;
  return null;
}

const FULL = "Three open items is the most for one day. Finish, drop or move one first.";

/** The day's items, and yesterday's open ones as suggestions to carry. */
export async function checklistFor(date: string): Promise<ChecklistResponse> {
  const yesterday = zone.nextDay(date, -1);
  const items = await store.listChecklist({ from: yesterday, to: date });
  return {
    date,
    items: items.filter((i) => i.date === date),
    suggestions: items.filter((i) => i.date === yesterday && i.status === "open"),
  };
}

export async function addItem(
  input: z.output<typeof ChecklistItemCreate>,
  now = Date.now(),
): Promise<ChecklistItem> {
  const goal = await checklistGoal(input.goal_id);
  const date = input.date ?? todayOf(now);
  const position = freePosition(await store.listChecklist({ from: date, to: date }), goal.id, date);
  if (position === null) throw conflict(FULL);
  const linked = input.linked_goal_id ? await linkedGoal(input.linked_goal_id) : null;
  return store.createChecklistItem({
    goal_id: goal.id,
    date,
    text: input.text.trim(),
    position,
    linked_goal_id: linked?.id ?? null,
    estimate_minutes: input.estimate_minutes ?? null,
  });
}

/** The goal an outcome serves (#318): any of the user's goals, of any kind; 404 otherwise. */
export async function linkedGoal(id: string): Promise<Goal> {
  const goal = z.uuid().safeParse(id).success ? await store.getGoal(id) : null;
  if (!goal) throw new HttpError("not_found", "Goal not found");
  return goal;
}

/** Text and status. `by` is who settles it: the user (routes, MCP) or the check in. */
export async function updateItem(
  id: string,
  patch: z.output<typeof ChecklistItemUpdate>,
  by: ChecklistSettledBy = "user",
  now = Date.now(),
): Promise<ChecklistItem> {
  const item = await itemOf(id);
  const changes: ChecklistPatch = {};
  if (patch.text !== undefined) changes.text = patch.text.trim();
  if (patch.status !== undefined && patch.status !== item.status) {
    if (item.status === "moved") throw conflict("This item moved to the next day. Change the new one.");
    if (patch.status === "open") {
      const day = await store.listChecklist({ from: item.date, to: item.date });
      const position = freePosition(day, item.goal_id, item.date);
      if (position === null) throw conflict(FULL);
      Object.assign(changes, { status: "open", position, settled_at: null, settled_by: null });
    } else {
      Object.assign(changes, {
        status: patch.status,
        settled_at: new Date(now).toISOString(),
        settled_by: by,
      });
    }
  }
  const updated = await store.updateChecklistItem(id, changes);
  if (!updated) throw notFound();
  return updated;
}

/** Moves an open item to the next day. */
export async function carryItem(id: string, now = Date.now()): Promise<ChecklistCarryResponse> {
  const item = await itemOf(id);
  if (item.status !== "open") throw conflict("Only an open item can be carried to the next day.");
  const next = zone.nextDay(item.date);
  const position = freePosition(await store.listChecklist({ from: next, to: next }), item.goal_id, next);
  if (position === null) throw conflict(`${next} already has three open items for this goal.`);
  // The new one first: if it cannot be made, the old one stays open.
  const created = await store.createChecklistItem({
    goal_id: item.goal_id,
    date: next,
    text: item.text,
    position,
    carried_from: item.id,
    linked_goal_id: item.linked_goal_id,
    estimate_minutes: item.estimate_minutes,
  });
  const moved = await store.updateChecklistItem(item.id, {
    status: "moved",
    settled_at: new Date(now).toISOString(),
    settled_by: "user",
  });
  if (!moved) throw notFound();
  return { moved, item: created };
}

export async function deleteItem(id: string): Promise<void> {
  await itemOf(id);
  if (!(await store.deleteChecklistItem(id))) throw notFound();
}
