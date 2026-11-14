import type { Event, Goal } from "@michael/shared";
import { goalForEvent, isOwnBlock, isSleepGoal } from "../score";

// How the brief reads the calendar. Which goal an event belongs to, and whether an event is the
// user's own, is decided in ONE place for the whole product: score/match.ts
// (`goal.target.calendar_titles`, and an event with `data.attendees > 0` is never the user's own
// block). This file only sorts calendar events into the three kinds the brief treats differently.

export type CalendarKind =
  /** The user's own block, matched to a goal. The only kind Michael may act on. */
  | "goal_block"
  /** The user's own entry with no goal (an errand, a trip). The title stays out of the brief. */
  | "own_other"
  /** Involves other people: busy time, no title, no names. */
  | "busy";

export interface PlanEvent {
  /** The calendar event's id. Never sent to the model: the brief uses short refs instead. */
  eventId: string;
  kind: CalendarKind;
  goal: Goal | null;
  title: string;
  start: number;
  end: number;
}

/** The goals a calendar block can count towards: the same set the score uses. */
export const matchableGoals = (goals: Goal[]) => goals.filter((g) => g.active && !isSleepGoal(g));

/** Every calendar event with an end, classified, in start order. */
export function planEvents(events: Event[], goals: Goal[]): PlanEvent[] {
  const matchable = matchableGoals(goals);
  const out: PlanEvent[] = [];
  for (const e of events) {
    if (e.type !== "calendar_event" || !e.end_at) continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    if (!(end > start)) continue;
    // Anything that is not provably the user's own is treated as busy: no title, never touched.
    const listed = Array.isArray(e.data.attendees) && e.data.attendees.length > 0;
    const own = isOwnBlock(e) && !listed;
    const goal = own ? (goalForEvent(e, matchable)?.goal ?? null) : null;
    out.push({
      eventId: e.id,
      kind: !own ? "busy" : goal ? "goal_block" : "own_other",
      goal,
      title: e.title,
      start,
      end,
    });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
