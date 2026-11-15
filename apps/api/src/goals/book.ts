import { type Event, type Goal, type Instruction, type Recommendation, voiceDuration } from "@michael/shared";
import { bookFocusBlock } from "../actions/calendar";
import { zone as athens, todayOf } from "../checklist/items";
import { busySpans, freeSlot } from "../checklist/offers";
import { HttpError } from "../http";
import { forbiddenBy } from "../instructions/protected";
import { MINUTE } from "../patterns/time";
import type { Span } from "../patterns/util";
import { calendarTitles, scoreRange } from "../score";
import { wakingDay } from "../score/week";
import { store } from "../store";

// Book time for a goal (#309), the one action on the Goals tab: the first free slot of `minutes`
// from now to the end of the week, inside the waking day, clear of the calendar and of time a
// standing instruction protects. The block is titled with the goal's first calendar title so the
// score counts it, then booked at once through bookFocusBlock (the same path as the MCP tool), so
// it is undoable until it starts with POST /v1/recommendations/:id/undo.

/** A slot never starts sooner than this from now, so it has not started by the time it is written. */
const LEAD_MS = 5 * MINUTE;

export interface GoalSlotInput {
  now: number;
  minutes: number;
  /** The block's calendar title, checked against the standing instructions. */
  title: string;
  /** Every goal, for the waking day (the sleep goal sets it). */
  goals: Goal[];
  /** Calendar events from now to the end of the week. */
  events: Event[];
  instructions: Instruction[];
}

/** The first free slot for the goal from now to Sunday night, or null. Pure. */
export function goalSlot(input: GoalSlotInput): Span | null {
  const { now, minutes, title } = input;
  const today = todayOf(now);
  const rules = input.instructions.filter((i) => i.active);
  const allowed = (slot: Span) => forbiddenBy(rules, title, slot.start, slot.end, athens).length === 0;
  const busy = busySpans(input.events);
  const waking = wakingDay(input.goals.filter((g) => g.active));
  for (const day of scoreRange(today, athens.name).days.filter((d) => d >= today)) {
    const slot = freeSlot(busy, day, now + LEAD_MS, minutes, waking, athens, allowed);
    if (slot) return slot;
  }
  return null;
}

export async function bookGoalTime(
  goalId: string,
  minutes: number,
  now = Date.now(),
): Promise<Recommendation> {
  const goal = await store.getGoal(goalId);
  if (!goal?.active) throw new HttpError("not_found", "Goal not found");
  const week = scoreRange(todayOf(now), athens.name);
  const [goals, events, instructions] = await Promise.all([
    store.listGoals(),
    store.listEvents({
      from: new Date(now).toISOString(),
      to: new Date(week.to).toISOString(),
      type: ["calendar_event"],
    }),
    store.listInstructions(),
  ]);
  const title = calendarTitles(goal)[0] ?? goal.title;
  const slot = goalSlot({ now, minutes, title, goals, events, instructions });
  if (!slot) throw new HttpError("conflict", `No free ${voiceDuration(minutes)} left this week`);
  return bookFocusBlock({
    start_at: new Date(slot.start).toISOString(),
    end_at: new Date(slot.end).toISOString(),
    title,
    goal_id: goal.id,
    requested_by: "Goals",
  });
}
