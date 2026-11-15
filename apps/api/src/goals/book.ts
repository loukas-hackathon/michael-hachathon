import { type Event, type Goal, type Instruction, type Recommendation, voiceDuration } from "@michael/shared";
import { bookFocusBlock } from "../actions/calendar";
import { zone as athens, todayOf } from "../checklist/items";
import { busySpans, freeSlot } from "../checklist/offers";
import { HttpError } from "../http";
import { dayList, forbiddenBy } from "../instructions/protected";
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
//
// When that length does not fit any more (#330), Michael takes the longest shorter one that does
// (quarter hours, never under 30 minutes) and says so. When nothing fits he says why: a standing
// instruction keeps the remaining time ("Sundays are kept clear, so no 90 minutes are left this
// week."), or the week simply has no room.

/** The shortest block booked in place of a longer one that no longer fits. */
const SHORTEST_INSTEAD = 30;
const STEP = 15;

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

/** Every calendar free slot of `minutes` from now to Sunday night, in order, until `take` says yes. */
function searchWeek(input: GoalSlotInput, minutes: number, take: (slot: Span) => boolean): Span | null {
  const today = todayOf(input.now);
  const busy = busySpans(input.events);
  const waking = wakingDay(input.goals.filter((g) => g.active));
  for (const day of scoreRange(today, athens.name).days.filter((d) => d >= today)) {
    const slot = freeSlot(busy, day, input.now + LEAD_MS, minutes, waking, athens, take);
    if (slot) return slot;
  }
  return null;
}

/** The first free slot for the goal from now to Sunday night, or null. Pure. */
export function goalSlot(input: GoalSlotInput): Span | null {
  const rules = input.instructions.filter((i) => i.active);
  return searchWeek(
    input,
    input.minutes,
    (slot) => forbiddenBy(rules, input.title, slot.start, slot.end, athens).length === 0,
  );
}

export type GoalBooking =
  /** A slot, of the length asked for or the longest shorter one that still fits. */
  | { slot: Span; minutes: number }
  /** Nothing fits. `kept` is the standing instruction that holds most of the time that would have. */
  | { slot: null; kept: Instruction | null };

/**
 * What Book can do for the goal now: the slot asked for, else the longest shorter one, else why
 * not. Pure.
 */
export function goalBooking(input: GoalSlotInput): GoalBooking {
  const asked = input.minutes;
  const shortest = Math.min(asked, SHORTEST_INSTEAD);
  for (let minutes = asked; minutes >= shortest; minutes -= minutes % STEP || STEP) {
    const slot = goalSlot({ ...input, minutes });
    if (slot) return { slot, minutes };
  }
  // Nothing fits. Every slot the calendar leaves open is kept by a standing instruction: the one
  // that keeps the most of them is why ("Sundays are kept clear", not the quiet hour before 07:00).
  const rules = input.instructions.filter((i) => i.active);
  const keeps = new Map<string, number>();
  searchWeek(input, shortest, (slot) => {
    for (const rule of forbiddenBy(rules, input.title, slot.start, slot.end, athens)) {
      keeps.set(rule.id, (keeps.get(rule.id) ?? 0) + 1);
    }
    return false;
  });
  let kept: Instruction | null = null;
  for (const rule of rules) {
    if ((keeps.get(rule.id) ?? 0) > (kept ? (keeps.get(kept.id) ?? 0) : 0)) kept = rule;
  }
  return { slot: null, kept };
}

/** Why nothing was booked, in Michael's words: the instruction that keeps the time, then the fact. */
export function noSlotLine(minutes: number, kept: Instruction | null): string {
  const none = `no ${voiceDuration(minutes)} are left this week.`;
  if (!kept) return `No free ${voiceDuration(minutes)} left this week.`;
  switch (kept.kind) {
    case "clear_day":
      return kept.days?.length
        ? `${dayList(kept.days)} are kept clear, so ${none}`
        : `That day is kept clear, so ${none}`;
    case "home_by":
      return kept.time ? `You're home by ${kept.time}, so ${none}` : `You're home by then, so ${none}`;
    case "quiet_hours":
      return `Your quiet hours cover the rest, so ${none}`;
    default:
      return `A standing instruction keeps the rest, so ${none}`;
  }
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
  const found = goalBooking({ now, minutes, title, goals, events, instructions });
  if (!found.slot) throw new HttpError("conflict", noSlotLine(minutes, found.kept));
  return bookFocusBlock({
    start_at: new Date(found.slot.start).toISOString(),
    end_at: new Date(found.slot.end).toISOString(),
    title,
    goal_id: goal.id,
    requested_by: "Goals",
    // A shorter block than asked for says so where the user reads why.
    note:
      found.minutes < minutes
        ? `No free ${voiceDuration(minutes)} left this week, so I took ${voiceDuration(found.minutes)}.`
        : undefined,
  });
}
