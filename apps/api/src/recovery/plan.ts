import {
  type Event,
  type Goal,
  type Instruction,
  type Recommendation,
  type ScoreBlock,
  voiceDuration,
} from "@michael/shared";
import { forbiddenBy } from "../instructions/protected";
import { DEFAULT_TIMEZONE, RULES } from "../patterns/context";
import { napIn } from "../patterns/sleep";
import { stays } from "../patterns/switching";
import { DAY, HOUR, MINUTE, Zone } from "../patterns/time";
import { buildTimeline } from "../patterns/timeline";
import { overlapWith, type Span, union } from "../patterns/util";
import { attendeesOf, goalForEvent } from "../score/match";
import { buildScore } from "../score/score";

// The recovery block (#167). A rule, not the model: when a planned goal block ENDS with less than
// half of it spent, Michael names the cause from the block's own data in one line and offers the
// smallest block that still counts, 25 minutes in the next free slot today. Pure: the clock, the
// events, the goals, the instructions and the recommendations so far go in; at most one offer
// comes out. The I/O (reading the store, creating the recommendation) is in ./offer.ts.
//
//   Qualifies   A block of today's score (score/score.ts) that has ended, within the last 2 hours,
//               with spent < half of planned. Never a block with other people in it (the score
//               already leaves meetings out; checked again here), never a block that already had
//               an offer, never a second offer the same day for one goal.
//   Cause       From the block's own data, first hit wins:
//                 1. an event with other people (`data.attendees` > 0) overlaps the block:
//                    "Meetings ate the block."
//                 2. most lost minutes were on the phone: "Instagram took it." when the score
//                    names the app, else "The phone took it."
//                 3. many switches and fragments inside the block, measured the way the
//                    switching pattern does (patterns/switching.ts: stays, a switch is a move to
//                    another app with no idle break, a fragment is a stay under 2 minutes): at
//                    least 15 minutes on screens and either 30 switches per active hour (one
//                    every fragment length) or half the screen time in fragments:
//                    "Too many switches."
//                 4. the night that ended that day held less than 6 hours of sleep, when sleep
//                    was recorded (the score's own night rule, score/week.ts): "Short night."
//                 5. otherwise "The block slipped."
//   Slot        The first 25 minutes on a 5 minute grid that start at least 15 minutes from now
//               and end by 22:00 today, overlapping no calendar event, outside the profile's
//               quiet hours and outside every time a standing instruction protects for a block
//               of that title (the same check the guard runs). No slot today: no offer.
//   Offer       A `create_focus_block` recommendation for the goal, titled with the line
//               ("Meetings ate the block. Take 25 minutes at 16:00. Still counts."), an offer and
//               never "I've booked". The block it would create starts with the goal's title, so
//               the score counts its minutes towards the goal (score/match.ts). The payload
//               carries `recovery_for` (the block's event id) so each block gets one offer.

export const RECOVERY = {
  blockMinutes: 25,
  /** The slot starts at least this long after now. */
  minLeadMs: 15 * MINUTE,
  /** ...and ends by this local time. */
  latestMinute: 22 * 60,
  /** Slots start on this grid, so the line says 16:00, not 15:57. */
  gridMs: 5 * MINUTE,
  /** A block qualifies when less than this share of it was spent. */
  spentShare: 0.5,
  /** Only blocks that ended this recently: an offer about this morning's block at 18:00 is stale. */
  freshMs: 2 * HOUR,
  /** Under this much sleep the night before is a short night. */
  shortNightMinutes: 6 * 60,
  /** Switching: enough screen time inside the block to judge it (the focus pattern's shortest stretch). */
  minActiveMs: RULES.minStretchMs,
  /** One switch per fragment length or more is many. */
  switchesPerHour: HOUR / RULES.fragmentMs,
  /** Half the screen time in stays shorter than a fragment is fragmented. */
  fragmentShare: 0.5,
} as const;

/** How every offer line ends; also how an offer that lost its action is recognised. */
export const OFFER_TAIL = "Still counts.";

export type RecoveryCause = "meeting" | "phone" | "switching" | "short_night" | "unknown";

export interface CauseFinding {
  cause: RecoveryCause;
  /** The first sentence of the line: "Meetings ate the block." */
  line: string;
  /** The numbers behind it, for the rationale. */
  detail: string;
}

/** A calendar entry that fills the whole day (a holiday marker), which neither eats a block nor fills a slot. */
const isAllDay = (e: Event) =>
  e.data?.all_day === true || (e.end_at !== null && Date.parse(e.end_at) - Date.parse(e.start_at) >= DAY);

const withOthers = (e: Event) => attendeesOf(e) > 0 || e.data?.with_others === true;

const spanOf = (e: Event): Span | null => {
  if (!e.end_at) return null;
  const start = Date.parse(e.start_at);
  const end = Date.parse(e.end_at);
  return end > start ? { start, end } : null;
};

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** Calendar events with other people that overlap the block. */
function meetingsIn(block: Span, events: Event[]): Span[] {
  return union(
    events.flatMap((e) => {
      if (e.type !== "calendar_event" || !withOthers(e) || isAllDay(e)) return [];
      const s = spanOf(e);
      return s && overlaps(s, block)
        ? [{ start: Math.max(s.start, block.start), end: Math.min(s.end, block.end) }]
        : [];
    }),
  );
}

/** Switches per active hour and the share of screen time in fragments, inside the block. */
export function switchingIn(block: Span, events: Event[]) {
  const list = stays(buildTimeline(events, block.start, block.end).attention);
  let activeMs = 0;
  let fragmentMs = 0;
  let switches = 0;
  list.forEach((stay, i) => {
    const ms = stay.end - stay.start;
    activeMs += ms;
    if (ms < RULES.fragmentMs) fragmentMs += ms;
    const prev = list[i - 1];
    if (prev && prev.appKey !== stay.appKey && stay.start - prev.end <= RULES.idleBreakMs) switches++;
  });
  return {
    activeMs,
    switches,
    perHour: activeMs > 0 ? switches / (activeMs / HOUR) : 0,
    fragmentShare: activeMs > 0 ? fragmentMs / activeMs : 0,
  };
}

/** Minutes slept in the night that ended on the block's day, before it started. Null without sleep data. */
export function nightBefore(block: Span, events: Event[], zone: Zone): number | null {
  const day = zone.dayOf(block.start);
  let minutes: number | null = null;
  for (const e of events) {
    if (e.type !== "sleep" || !e.end_at) continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    if (!(end > start) || end - start > DAY || end > block.start || zone.dayOf(end) !== day) continue;
    if (napIn(zone, start, end)) continue;
    const recorded = e.data?.duration_min;
    minutes =
      (minutes ?? 0) + (typeof recorded === "number" && recorded > 0 ? recorded : (end - start) / MINUTE);
  }
  return minutes === null ? null : Math.round(minutes);
}

/** Why the block slipped, from its own data. The order is the rule's: meeting, phone, switching, night. */
export function recoveryCause(block: ScoreBlock, events: Event[], zone: Zone): CauseFinding {
  const span = { start: Date.parse(block.start_at), end: Date.parse(block.end_at) };

  const meetings = meetingsIn(span, events);
  if (meetings.length) {
    const minutes = Math.round(overlapWith(span, meetings) / MINUTE);
    return {
      cause: "meeting",
      line: "Meetings ate the block.",
      detail: `a meeting with other people took ${voiceDuration(minutes)} of it`,
    };
  }

  let phone = 0;
  let mac = 0;
  const phoneApps = new Map<string, number>();
  for (const s of block.lost) {
    if (s.device === "iphone") {
      phone += s.minutes;
      if (s.kind === "app") phoneApps.set(s.what, (phoneApps.get(s.what) ?? 0) + s.minutes);
    } else mac += s.minutes;
  }
  if (phone > 0 && phone > mac) {
    const top = [...phoneApps.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      cause: "phone",
      line: top ? `${top[0]} took it.` : "The phone took it.",
      detail: top
        ? `${voiceDuration(phone)} lost on the phone, ${voiceDuration(top[1])} of it on ${top[0]}`
        : `${voiceDuration(phone)} lost on the phone`,
    };
  }

  const sw = switchingIn(span, events);
  if (
    sw.activeMs >= RECOVERY.minActiveMs &&
    (sw.perHour >= RECOVERY.switchesPerHour || sw.fragmentShare >= RECOVERY.fragmentShare)
  ) {
    return {
      cause: "switching",
      line: "Too many switches.",
      detail: `${sw.switches} app switches in ${voiceDuration(sw.activeMs / MINUTE)} on screens, ${Math.round(sw.fragmentShare * 100)}% of it in stays under 2 minutes`,
    };
  }

  const slept = nightBefore(span, events, zone);
  if (slept !== null && slept < RECOVERY.shortNightMinutes) {
    return {
      cause: "short_night",
      line: "Short night.",
      detail: `you slept ${voiceDuration(slept)} the night before`,
    };
  }

  return { cause: "unknown", line: "The block slipped.", detail: "the data shows no single cause" };
}

/** Quiet hours from the profile ("22:00" to "07:00") as spans touching the local day. */
function quietSpans(quiet: { start: string; end: string } | null, day: string, zone: Zone): Span[] {
  if (!quiet) return [];
  const m = (clock: string) => {
    const [h, min] = clock.split(":").map(Number);
    return (h ?? 0) * 60 + (min ?? 0);
  };
  const from = m(quiet.start);
  const to = m(quiet.end);
  if (from === to) return [];
  // Past midnight: last night's tail and tonight's start.
  if (to < from) {
    return [
      { start: zone.at(zone.nextDay(day, -1), from), end: zone.at(day, to) },
      { start: zone.at(day, from), end: zone.at(day, to + 1440) },
    ];
  }
  return [{ start: zone.at(day, from), end: zone.at(day, to) }];
}

export interface SlotInput {
  now: number;
  zone: Zone;
  events: Event[];
  instructions: Instruction[];
  quiet: { start: string; end: string } | null;
  /** The title the block would carry, for the instructions' exceptions. */
  title: string;
}

/** The first free 25 minutes later today, or null. */
export function recoverySlot(input: SlotInput): Span | null {
  const { now, zone } = input;
  const day = zone.dayOf(now);
  const length = RECOVERY.blockMinutes * MINUTE;
  const latest = zone.at(day, RECOVERY.latestMinute);
  const busy = union([
    ...input.events.flatMap((e) => {
      if (e.type !== "calendar_event" || isAllDay(e)) return [];
      const s = spanOf(e);
      return s ? [s] : [];
    }),
    ...quietSpans(input.quiet, day, zone),
  ]);
  const active = input.instructions.filter((i) => i.active);
  const first = Math.ceil((now + RECOVERY.minLeadMs) / RECOVERY.gridMs) * RECOVERY.gridMs;
  for (let start = first; start + length <= latest; start += RECOVERY.gridMs) {
    const slot = { start, end: start + length };
    if (busy.some((b) => overlaps(b, slot))) continue;
    if (forbiddenBy(active, input.title, slot.start, slot.end, zone).length) continue;
    return slot;
  }
  return null;
}

/** The block a recovery offer is for, from its payload. Null for any other recommendation. */
export const recoveryFor = (rec: Pick<Recommendation, "action">): string | null => {
  const v = rec.action?.payload?.recovery_for;
  return typeof v === "string" ? v : null;
};

/** The local day an offer is for: its slot's day, else the day it was made. */
export function offerDay(rec: Pick<Recommendation, "action" | "created_at">, zone: Zone): string {
  const start = rec.action?.payload?.start_at;
  const t = typeof start === "string" ? Date.parse(start) : Number.NaN;
  return zone.dayOf(Number.isFinite(t) ? t : Date.parse(rec.created_at));
}

/**
 * The calendar title of the recovery block: the goal's title first, so the score counts it towards
 * the goal (score/match.ts, the goal title rule). When another goal's calendar titles would claim
 * that title, the slipped block's own title, which already matched this goal.
 */
export function recoveryTitle(goal: Goal, block: ScoreBlock, goals: Goal[]): string {
  const minutes = `${RECOVERY.blockMinutes} minutes`;
  const probe = (title: string): Event => ({
    id: "probe",
    source: "agent",
    type: "calendar_event",
    start_at: block.start_at,
    end_at: block.end_at,
    title,
    data: {},
    external_id: null,
    created_at: block.start_at,
  });
  const named = `${goal.title}: ${minutes}`;
  if (goalForEvent(probe(named), goals)?.goal.id === goal.id) return named;
  const own = `${block.title}: ${minutes}`;
  return goalForEvent(probe(own), goals)?.goal.id === goal.id ? own : named;
}

export interface RecoveryInput {
  /** The current instant, ISO. */
  now: string;
  timezone?: string;
  /** Today's events and the night before (calendar, device, sleep). */
  events: Event[];
  goals: Goal[];
  instructions: Instruction[];
  /** The profile's quiet hours. */
  quiet: { start: string; end: string } | null;
  /** The user's recommendations so far (any status), to keep one offer per block and per goal a day. */
  recommendations: (Pick<Recommendation, "goal_id" | "action" | "created_at"> & { title?: string })[];
}

export interface RecoveryOffer {
  block: ScoreBlock;
  cause: RecoveryCause;
  slot: Span;
  recommendation: {
    goal_id: string;
    title: string;
    rationale: string;
    action: {
      kind: "create_focus_block";
      payload: Record<string, unknown>;
      involves_others: false;
      undo_until: string;
    };
  };
}

/** At most one recovery offer right now: for the block that ended last, when one qualifies. */
export function planRecovery(input: RecoveryInput): RecoveryOffer | null {
  const zone = new Zone(input.timezone ?? DEFAULT_TIMEZONE);
  const now = Date.parse(input.now);
  const day = zone.dayOf(now);
  const goals = input.goals.filter((g) => g.active);
  const score = buildScore(input.events, goals, {
    date: day,
    now: input.now,
    timezone: zone.name,
    instructions: input.instructions,
  });

  const offeredBlocks = new Set<string>();
  const offeredGoalsToday = new Set<string>();
  for (const r of input.recommendations) {
    const block = recoveryFor(r);
    if (!block) {
      // An offer the guard refused keeps its line and loses its action: it still counts as the
      // goal's offer for the day, so the rule does not try again at every check.
      if (!r.action && r.goal_id && r.title?.endsWith(OFFER_TAIL) && offerDay(r, zone) === day) {
        offeredGoalsToday.add(r.goal_id);
      }
      continue;
    }
    offeredBlocks.add(block);
    if (r.goal_id && offerDay(r, zone) === day) offeredGoalsToday.add(r.goal_id);
  }
  const byId = new Map(input.events.map((e) => [e.id, e]));

  const candidates = score.day.blocks
    .filter((b) => {
      const end = Date.parse(b.end_at);
      if (end > now || now - end > RECOVERY.freshMs) return false;
      if (b.planned_minutes <= 0 || b.spent_minutes >= b.planned_minutes * RECOVERY.spentShare) return false;
      if (offeredBlocks.has(b.event_id) || offeredGoalsToday.has(b.goal_id)) return false;
      const own = byId.get(b.event_id);
      return !(own && withOthers(own));
    })
    .sort((a, b) => Date.parse(b.end_at) - Date.parse(a.end_at));

  for (const block of candidates) {
    const goal = goals.find((g) => g.id === block.goal_id);
    if (!goal) continue;
    const title = recoveryTitle(goal, block, goals);
    const slot = recoverySlot({
      now,
      zone,
      events: input.events,
      instructions: input.instructions,
      quiet: input.quiet,
      title,
    });
    // No slot today: no offer. A block that ended earlier has no better slot, so stop here.
    if (!slot) return null;
    const found = recoveryCause(block, input.events, zone);
    const at = zone.clock(slot.start);
    const startAt = new Date(slot.start).toISOString();
    return {
      block,
      cause: found.cause,
      slot,
      recommendation: {
        goal_id: goal.id,
        title: `${found.line} Take ${RECOVERY.blockMinutes} minutes at ${at}. ${OFFER_TAIL}`,
        rationale: `${block.title}, ${zone.clock(Date.parse(block.start_at))} to ${zone.clock(Date.parse(block.end_at))}: ${voiceDuration(block.spent_minutes)} of ${voiceDuration(block.planned_minutes)} spent; ${found.detail}. ${RECOVERY.blockMinutes} minutes at ${at} still counts towards ${goal.title}.`,
        action: {
          kind: "create_focus_block",
          payload: {
            start_at: startAt,
            end_at: new Date(slot.end).toISOString(),
            title,
            goal_id: goal.id,
            recovery_for: block.event_id,
            recovery_cause: found.cause,
          },
          involves_others: false,
          undo_until: startAt,
        },
      },
    };
  }
  return null;
}
