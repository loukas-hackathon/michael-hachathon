import {
  type ChecklistItem,
  type Event,
  type Goal,
  goalKind,
  type Recommendation,
  type ScoreGoal,
  voiceDuration,
} from "@michael/shared";
import { MINUTE, type Zone } from "../patterns/time";
import { type Span, union } from "../patterns/util";
import { behindPace, calendarTitles, goalForEvent, scoreRange } from "../score";
import { type WakingDay, wakingDay, wakingSpan } from "../score/week";
import { checklistOrder, type NewRecommendation, store } from "../store";
import { zone as athens, todayOf } from "./items";

// Michael's two actions for checklist and count goals (#238). Both are OFFERS: stored
// recommendations with a `create_focus_block` action, never carried out here. Every one goes
// through the store's createRecommendation, so the instruction guard (instructions/guard.ts)
// applies: one that lands in protected time (a clear Sunday) keeps its advice and loses its action.
//
//   First outcome   The first open checklist item of today gets one offered hour, the first free
//                   one from now inside the waking day. At most once a day.
//   Behind pace     A count goal with more sessions left than days left gets one offered slot,
//                   the first free one from today on a day without a block of the goal yet, as
//                   long as the goal's usual block (60 minutes without history). At most once a
//                   day per goal.
//
// "Once a day" rests on the title, which names the day: an offer with the same title already
// stored, whatever its status, means it was made. planOffers is pure; offerGoalActions reads the
// store and writes the offers.

export const OFFER_RULES = {
  /** The focus block offered for the first outcome. */
  outcomeMinutes: 60,
  /** A count session when the goal has no blocks this week to take the length from. */
  sessionMinutes: 60,
  /** Offers start on a quarter hour. */
  stepMs: 15 * MINUTE,
} as const;

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Sat 14 Nov" for a local day. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayFormat.format(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).replace(",", "");
}

export const outcomeTitle = (day: string) => `An hour for your first outcome, ${dayLabel(day)}`;
export const sessionTitle = (goal: Goal, day: string) =>
  `One more session for ${goal.title}, ${dayLabel(day)}`;

/** Calendar entries that hold time (not all day markers), merged. */
function busySpans(events: Event[]): Span[] {
  const spans: Span[] = [];
  for (const e of events) {
    if (e.type !== "calendar_event" || !e.end_at || e.data?.all_day === true) continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    if (end > start) spans.push({ start, end });
  }
  return union(spans);
}

/** The first free span of `minutes` on `day`, from `from` on, inside the waking day. */
export function freeSlot(
  busy: Span[],
  day: string,
  from: number,
  minutes: number,
  waking: WakingDay,
  zone: Zone,
): Span | null {
  const w = wakingSpan(zone, day, waking);
  const length = minutes * MINUTE;
  let cursor = Math.max(w.start, Math.ceil(from / OFFER_RULES.stepMs) * OFFER_RULES.stepMs);
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= w.end) break;
    if (b.start - cursor >= length) break;
    cursor = Math.max(cursor, Math.ceil(b.end / OFFER_RULES.stepMs) * OFFER_RULES.stepMs);
  }
  return w.end - cursor >= length ? { start: cursor, end: cursor + length } : null;
}

const focusBlock = (slot: Span, title: string): NonNullable<Recommendation["action"]> => ({
  kind: "create_focus_block",
  payload: {
    start_at: new Date(slot.start).toISOString(),
    end_at: new Date(slot.end).toISOString(),
    title: title.slice(0, 200),
  },
  involves_others: false,
  undo_until: new Date(slot.start).toISOString(),
});

export interface OfferInput {
  now: number;
  zone: Zone;
  /** Active and paused goals; only active ones are read. */
  goals: Goal[];
  /** Checklist items of today (more is fine). */
  items: ChecklistItem[];
  /** The score's goal rows for this week, for the count goals. Leave out to skip the count offers. */
  rows?: ScoreGoal[];
  /** Calendar events of this week, Monday to Sunday. */
  events: Event[];
  /** Recommendations already stored, any status. */
  existing: Recommendation[];
}

export function planOffers(input: OfferInput): NewRecommendation[] {
  const { now, zone } = input;
  const goals = input.goals.filter((g) => g.active);
  const today = zone.dayOf(now);
  const titles = new Set(input.existing.map((r) => r.title));
  const busy = busySpans(input.events);
  const waking = wakingDay(goals);
  const out: NewRecommendation[] = [];

  // The first open outcome of today.
  const checklistGoals = new Set(goals.filter((g) => goalKind(g) === "checklist").map((g) => g.id));
  const first = input.items
    .filter((i) => i.date === today && i.status === "open" && checklistGoals.has(i.goal_id))
    .sort(checklistOrder)[0];
  if (first && !titles.has(outcomeTitle(today))) {
    const slot = freeSlot(busy, today, now, OFFER_RULES.outcomeMinutes, waking, zone);
    if (slot) {
      out.push({
        goal_id: first.goal_id,
        title: outcomeTitle(today),
        rationale: `"${first.text}" is still open. I found ${voiceDuration(OFFER_RULES.outcomeMinutes)} free at ${zone.clock(slot.start)}. One tap books it, and you can undo it until it starts.`,
        action: focusBlock(slot, first.text),
        source: "analysis",
      });
    }
  }

  // Count goals behind pace.
  const countGoals = goals.filter((g) => goalKind(g) === "count");
  const days = scoreRange(today, zone.name).days.filter((d) => d >= today);
  for (const row of input.rows ?? []) {
    const goal = countGoals.find((g) => g.id === row.goal_id);
    if (!goal || !row.count || !behindPace(row.count)) continue;
    const title = sessionTitle(goal, today);
    if (titles.has(title)) continue;
    const own = input.events.filter((e) => goalForEvent(e, countGoals)?.goal.id === goal.id);
    const lengths = own
      .map((e) => Math.round((Date.parse(e.end_at ?? e.start_at) - Date.parse(e.start_at)) / MINUTE))
      .filter((m) => m > 0)
      .sort((a, b) => a - b);
    const minutes = lengths[Math.floor(lengths.length / 2)] ?? OFFER_RULES.sessionMinutes;
    const booked = new Set(own.map((e) => zone.dayOf(Date.parse(e.start_at))));
    let slot: Span | null = null;
    for (const day of days) {
      if (booked.has(day)) continue;
      slot = freeSlot(busy, day, now, minutes, waking, zone);
      if (slot) break;
    }
    if (!slot) continue;
    const { done, target, left, days_left } = row.count;
    const when = `${zone.dayOf(slot.start) === today ? "today" : dayLabel(zone.dayOf(slot.start))} at ${zone.clock(slot.start)}`;
    out.push({
      goal_id: goal.id,
      title,
      rationale: `${done} of ${target} done, ${left} left and ${days_left} ${days_left === 1 ? "day" : "days"} to go. I found ${voiceDuration(minutes)} free ${when}. One tap books it, and you can undo it until it starts.`,
      action: focusBlock(slot, calendarTitles(goal)[0] ?? goal.title),
      source: "analysis",
    });
  }
  return out;
}

/**
 * Makes today's offers that are due and not made yet, through the store (and so the guard).
 * `rows`: the score's goal rows for this week, when the caller has them; without them only the
 * checklist offer is considered.
 */
export async function offerGoalActions(
  opts: { now?: number; rows?: ScoreGoal[] } = {},
): Promise<Recommendation[]> {
  const now = opts.now ?? Date.now();
  const goals = (await store.listGoals()).filter((g) => g.active);
  const kinds = new Set(goals.map((g) => goalKind(g)));
  if (!kinds.has("checklist") && !kinds.has("count")) return [];
  const today = todayOf(now);
  const week = scoreRange(today, athens.name);
  const [items, events, existing] = await Promise.all([
    store.listChecklist({ from: today, to: today }),
    store.listEvents({
      from: new Date(athens.startOfDay(week.days[0] ?? today)).toISOString(),
      to: new Date(week.to).toISOString(),
      type: ["calendar_event"],
    }),
    store.listRecommendations(),
  ]);
  const offers = planOffers({ now, zone: athens, goals, items, rows: opts.rows, events, existing });
  const made: Recommendation[] = [];
  for (const offer of offers) made.push(await store.createRecommendation(offer));
  return made;
}
