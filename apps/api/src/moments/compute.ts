import type { Event, Goal, Moment, MomentGoal, MomentKind, MomentMove, MomentStretch } from "@michael/shared";
import { buildContext, DEFAULT_TIMEZONE } from "../patterns/context";
import { analyseFocus, type GoalBlock, goalBlocks, type RawDisruption } from "../patterns/focus";
import { duration, label } from "../patterns/format";
import { DAY, HOUR, MINUTE, Zone } from "../patterns/time";
import { subjectOf } from "../patterns/timeline";
import { iso, type Span, sum, union, unionLength } from "../patterns/util";

// Morning and Evening moments, computed. Pure: events, goals and the clock come in, numbers come
// out. Only the headline may later be phrased by a model (phrase.ts); everything else is here.

/** Days before today that set the usual day (what is normally lost, and when). */
export const HISTORY_DAYS = 7;
/** Free time a suggested block may use, local wall clock. */
const DAY_OPENS = 8 * 60;
const DAY_CLOSES = 21 * 60;
const MIN_SLOT = 30;
const MAX_SLOT = 90;
/** How a move names the time it books: goal titles are often long targets ("4h of deep work per day"). */
const ACTIVITY: Record<Goal["category"], string> = {
  work: "deep work",
  gym: "training",
  rest: "sleep",
  food: "meals",
};

export type MomentCore = Omit<Moment, "headline" | "phrased_by">;

export interface MomentInput {
  kind: MomentKind;
  /** Every event in `momentRange(now)`. */
  events: Event[];
  goals: Goal[];
  /** The current instant, ISO. Passed in so the function stays pure. */
  now: string;
  timezone?: string;
}

const toMin = (ms: number) => Math.max(0, Math.round(ms / MINUTE));
const overlap = (s: Span, a: number, z: number) => Math.max(0, Math.min(s.end, z) - Math.max(s.start, a));

/** The events a moment needs: the history days (and the night before them) to the end of tomorrow. */
export function momentRange(now: string, timezone = DEFAULT_TIMEZONE): { from: string; to: string } {
  const zone = new Zone(timezone);
  const today = zone.dayOf(Date.parse(now));
  return {
    from: iso(zone.startOfDay(zone.nextDay(today, -HISTORY_DAYS)) - 12 * HOUR),
    to: iso(zone.startOfDay(zone.nextDay(today, 2))),
  };
}

/** First free stretch of at least `minutes` in [from, to), around the busy spans. */
export function freeSlot(busy: Span[], from: number, to: number, minutes: number): Span | null {
  const need = minutes * MINUTE;
  let cursor = from;
  for (const b of union(busy)) {
    if (b.end <= cursor) continue;
    if (b.start >= to) break;
    if (b.start - cursor >= need) return { start: cursor, end: cursor + need };
    cursor = Math.max(cursor, b.end);
  }
  return to - cursor >= need ? { start: cursor, end: cursor + need } : null;
}

/** A sensible block for what is left: the gap spread over the days left, 30 to 90 minutes, in quarters. */
export function slotLength(unplanned: number, daysLeft: number): number {
  const perDay = unplanned / Math.max(1, daysLeft);
  return Math.min(MAX_SLOT, Math.max(MIN_SLOT, Math.round(perDay / 15) * 15));
}

export function computeMoment(input: MomentInput): MomentCore {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const zone = new Zone(timezone);
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new RangeError("now must be a valid ISO datetime");

  const today = zone.dayOf(now);
  const todayStart = zone.startOfDay(today);
  const tomorrow = zone.nextDay(today);
  const tomorrowStart = zone.startOfDay(tomorrow);
  const dayAfterStart = zone.startOfDay(zone.nextDay(tomorrow));
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const weekStartDay = zone.nextDay(today, -weekday);
  const weekStart = zone.startOfDay(weekStartDay);
  const weekEnd = zone.startOfDay(zone.nextDay(weekStartDay, 7));
  const historyStart = zone.startOfDay(zone.nextDay(today, -HISTORY_DAYS));
  const daysLeft = 7 - weekday;
  const { events } = input;
  const goals = input.goals.filter((g) => g.active);

  // What actually happened, up to now: interruptions inside goal blocks and focus stretches.
  let disruptions: RawDisruption[] = [];
  let usageDays = new Set<string>();
  if (now > historyStart) {
    const ctx = buildContext(events, {
      from: iso(historyStart),
      to: iso(now),
      now: input.now,
      timezone,
      goals,
    });
    disruptions = analyseFocus(ctx).disruptions;
    usageDays = new Set(ctx.tl.attention.flatMap((s) => zone.splitByDay(s.start, s.end).map((p) => p.day)));
  }
  const lostBetween = (a: number, z: number, goalId?: string) =>
    sum(
      disruptions
        .filter((d) => d.start >= a && d.start < z && (goalId === undefined || d.goalId === goalId))
        .map((d) => d.lostMs),
    );

  // The plan: goal blocks from Monday to the end of tomorrow (tomorrow may be next week).
  const plan: GoalBlock[] = goalBlocks(events, goals, weekStart, Math.max(weekEnd, dayAfterStart));
  const titleOf = new Map(events.map((e) => [e.id, e.title]));
  const workouts: Span[] = events
    .filter((e) => e.type === "workout" && e.end_at)
    .map((e) => ({ start: Date.parse(e.start_at), end: Date.parse(e.end_at as string) }));
  const sleeps: Span[] = events
    .filter((e) => e.type === "sleep" && e.end_at)
    .map((e) => ({ start: Date.parse(e.start_at), end: Date.parse(e.end_at as string) }))
    .filter((s) => s.end > s.start && s.end - s.start <= DAY);

  const goalLines: MomentGoal[] = [];
  for (const g of goals) {
    const blocks = plan.filter((b) => b.goal.id === g.id);
    if (g.weekly_budget_minutes === null && blocks.length === 0) continue;
    const isRest = g.category === "rest";
    const perDay = (g.weekly_budget_minutes ?? 0) / 7;
    const blockTime = (a: number, z: number) => sum(blocks.map((b) => overlap(b, a, z)));
    const spent = (a: number, z: number) => {
      const until = Math.min(z, now);
      if (!(until > a)) return 0;
      // Rest is sleep, counted on the day it ends. Gym is the workouts the watch saw, when it saw any.
      if (isRest) return sum(sleeps.filter((s) => s.end >= a && s.end < until).map((s) => s.end - s.start));
      if (g.category === "gym" && workouts.length > 0)
        return unionLength(
          workouts.map((w) => ({ start: Math.max(w.start, a), end: Math.min(w.end, until) })),
        );
      return Math.max(0, blockTime(a, until) - lostBetween(a, until, g.id));
    };
    const spentWeek = toMin(spent(weekStart, now));
    const plannedAhead = isRest
      ? toMin(((perDay * Math.max(0, weekEnd - now)) / DAY) * MINUTE)
      : toMin(blockTime(now, weekEnd));
    goalLines.push({
      goal_id: g.id,
      title: g.title,
      category: g.category,
      budget_minutes: g.weekly_budget_minutes,
      spent_week_minutes: spentWeek,
      planned_today_minutes: isRest ? Math.round(perDay) : toMin(blockTime(todayStart, tomorrowStart)),
      spent_today_minutes: toMin(spent(todayStart, tomorrowStart)),
      lost_today_minutes: isRest ? 0 : toMin(lostBetween(todayStart, now, g.id)),
      planned_ahead_minutes: plannedAhead,
      // Sleep is not booked, so it has no unplanned time.
      unplanned_minutes:
        g.weekly_budget_minutes === null || isRest
          ? null
          : Math.max(0, g.weekly_budget_minutes - spentWeek - plannedAhead),
    });
  }

  // The usual day: what is lost on the history days that had any device data.
  const historyDays = [...usageDays].filter((d) => d >= zone.dayOf(historyStart) && d < today);
  const baseline =
    historyDays.length > 0 ? toMin(lostBetween(historyStart, todayStart) / historyDays.length) : null;
  const work = goalLines.filter((l) => l.category !== "rest");
  const planned = sum(work.map((l) => l.planned_today_minutes));
  const spentToday = sum(work.map((l) => l.spent_today_minutes));
  const lostToday = toMin(lostBetween(todayStart, now));
  const wonBack = input.kind === "evening" && baseline !== null ? Math.max(0, baseline - lostToday) : 0;

  // The biggest gap in the week, for a suggestion or tomorrow's first move.
  const gap = work
    .filter((l) => (l.unplanned_minutes ?? 0) > 0)
    .sort((a, b) => (b.unplanned_minutes ?? 0) - (a.unplanned_minutes ?? 0))[0];
  const busyOn = (a: number, z: number): Span[] =>
    events
      .filter((e) => e.type === "calendar_event" && e.end_at)
      .map((e) => ({ start: Date.parse(e.start_at), end: Date.parse(e.end_at as string) }))
      .filter((s) => s.end > a && s.start < z);
  const bookGap = (day: string, after: number, when: string): MomentMove | null => {
    if (!gap) return null;
    const minutes = slotLength(gap.unplanned_minutes ?? 0, daysLeft);
    const dayStart = zone.startOfDay(day);
    const from = Math.max(after, zone.at(day, DAY_OPENS));
    const to = zone.at(day, DAY_CLOSES);
    const slot =
      to > from ? freeSlot(busyOn(dayStart, zone.startOfDay(zone.nextDay(day))), from, to, minutes) : null;
    const left = Math.max(0, (gap.budget_minutes ?? 0) - gap.spent_week_minutes);
    const what = ACTIVITY[gap.category];
    return {
      title: slot
        ? `Book ${minutes} minutes of ${what} at ${zone.clock(slot.start)}${when}`
        : `Find ${minutes} minutes for ${what}${when}`,
      rationale:
        gap.planned_ahead_minutes > 0
          ? `${left} of ${gap.budget_minutes} minutes for ${gap.title} left this week and ${gap.planned_ahead_minutes} planned, so ${gap.unplanned_minutes} are not booked.`
          : `${left} of ${gap.budget_minutes} minutes for ${gap.title} left this week and none of it booked.`,
      action_kind: slot ? "create_focus_block" : null,
      start_at: slot ? iso(slot.start) : null,
      end_at: slot ? iso(slot.end) : null,
      goal_id: gap.goal_id,
    };
  };

  const base = {
    kind: input.kind,
    day: today,
    timezone,
    generated_at: iso(now),
    goals: goalLines,
    totals: {
      planned_minutes: planned,
      spent_minutes: spentToday,
      lost_minutes: lostToday,
      baseline_lost_minutes: baseline,
      won_back_minutes: wonBack,
    },
  };

  if (input.kind === "morning") {
    const risk = atRisk();
    const at_risk = risk?.stretch ?? null;
    const suggestions: MomentMove[] = [];
    if (at_risk?.usual_trigger) {
      const s = Date.parse(at_risk.start_at);
      const e = Date.parse(at_risk.end_at);
      const onPhone = risk?.device === "iphone";
      suggestions.push({
        title: onPhone
          ? `Phone in another room from ${zone.clock(s)} to ${zone.clock(e)}`
          : `Silence ${at_risk.usual_trigger} from ${zone.clock(s)} to ${zone.clock(e)}`,
        rationale: `On a usual day you lose ${at_risk.expected_lost_minutes} minutes in these hours, mostly to ${at_risk.usual_trigger} (last ${at_risk.history_days} days).`,
        action_kind: onPhone ? "reminder" : "block_mac_app",
        start_at: at_risk.start_at,
        end_at: at_risk.end_at,
        goal_id: at_risk.goal_id,
      });
    }
    const book = bookGap(today, now, "");
    if (book) suggestions.push(book);
    return { ...base, at_risk, suggestions, lesson: null, first_move: null };
  }

  return { ...base, at_risk: null, suggestions: [], lesson: lesson(), first_move: firstMove() };

  // ---------- morning: the stretch most likely to be lost ----------

  // The device of the usual trigger decides the wording of the suggestion.
  function atRisk(): { stretch: MomentStretch; device: "mac" | "iphone" | null } | null {
    if (historyDays.length === 0) return null;
    const lostByHour = new Array<number>(24).fill(0);
    const byHour = Array.from(
      { length: 24 },
      () => new Map<string, { ms: number; device: "mac" | "iphone" }>(),
    );
    for (const d of disruptions) {
      if (d.start < historyStart || d.start >= todayStart) continue;
      const h = zone.hourOf(d.start);
      lostByHour[h] = (lostByHour[h] ?? 0) + d.lostMs;
      const name = label(subjectOf(d.trigger));
      const m = byHour[h] as Map<string, { ms: number; device: "mac" | "iphone" }>;
      const cur = m.get(name) ?? { ms: 0, device: d.trigger.device };
      cur.ms += d.lostMs;
      m.set(name, cur);
    }
    const hourStart = (h: number) => zone.at(today, h * 60);
    const expected = (s: Span) => {
      let ms = 0;
      for (let h = 0; h < 24; h++) {
        const part = overlap(s, hourStart(h), hourStart(h + 1));
        if (part > 0) ms += ((lostByHour[h] ?? 0) / historyDays.length) * (part / HOUR);
      }
      return ms;
    };

    type Candidate = Span & { title: string; goalId: string | null; blockId: string | null };
    const candidates: Candidate[] = plan
      .filter((b) => b.goal.category !== "rest" && b.end > now && b.start < tomorrowStart)
      .map((b) => ({
        start: Math.max(b.start, now),
        end: b.end,
        title: titleOf.get(b.eventId) ?? b.goal.title,
        goalId: b.goal.id,
        blockId: b.eventId,
      }));
    // Nothing booked: the remaining hour of the day that usually costs the most.
    if (candidates.length === 0) {
      for (let h = Math.floor(DAY_OPENS / 60); h < Math.floor(DAY_CLOSES / 60); h++) {
        if (hourStart(h + 1) <= now) continue;
        candidates.push({
          start: Math.max(hourStart(h), now),
          end: hourStart(h + 1),
          title: "Unbooked time",
          goalId: null,
          blockId: null,
        });
      }
    }
    let best: (Candidate & { ms: number }) | null = null;
    for (const c of candidates) {
      const ms = expected(c);
      if (!best || ms > best.ms) best = { ...c, ms };
    }
    if (!best || toMin(best.ms) < 1) return null;

    const triggers = new Map<string, { ms: number; device: "mac" | "iphone" }>();
    for (let h = 0; h < 24; h++) {
      if (overlap(best, hourStart(h), hourStart(h + 1)) === 0) continue;
      for (const [name, v] of byHour[h] ?? []) {
        const cur = triggers.get(name) ?? { ms: 0, device: v.device };
        cur.ms += v.ms;
        triggers.set(name, cur);
      }
    }
    const top = [...triggers.entries()].sort((a, b) => b[1].ms - a[1].ms)[0];
    return {
      device: top?.[1].device ?? null,
      stretch: {
        start_at: iso(best.start),
        end_at: iso(best.end),
        title: best.title,
        goal_id: best.goalId,
        block_event_id: best.blockId,
        expected_lost_minutes: toMin(best.ms),
        history_days: historyDays.length,
        usual_trigger: top?.[0] ?? null,
      },
    };
  }

  // ---------- evening: one lesson and tomorrow's first move ----------

  function topTriggerToday(): { name: string; ms: number; count: number } | null {
    const t = new Map<string, { ms: number; count: number }>();
    for (const d of disruptions) {
      if (d.start < todayStart || d.start >= now) continue;
      const name = label(subjectOf(d.trigger));
      const cur = t.get(name) ?? { ms: 0, count: 0 };
      cur.ms += d.lostMs;
      cur.count += 1;
      t.set(name, cur);
    }
    const top = [...t.entries()].sort((a, b) => b[1].ms - a[1].ms)[0];
    return top && toMin(top[1].ms) >= 1 ? { name: top[0], ...top[1] } : null;
  }

  function lesson(): string {
    const top = topTriggerToday();
    if (top) {
      const n = top.count === 1 ? "1 interruption" : `${top.count} interruptions`;
      return `${top.name} cost ${duration(toMin(top.ms))} in ${n} today.`;
    }
    if (planned === 0) return "No goal blocks today. Time you do not book goes elsewhere.";
    if (spentToday >= planned) return "Every planned minute held. Book tomorrow the same way.";
    return `${duration(planned - spentToday)} of planned goal time did not happen.`;
  }

  function firstMove(): MomentMove | null {
    const next = plan
      .filter((b) => b.goal.category !== "rest" && b.start >= tomorrowStart && b.start < dayAfterStart)
      .sort((a, b) => a.start - b.start)[0];
    if (next) {
      const top = topTriggerToday();
      const title = titleOf.get(next.eventId) ?? next.goal.title;
      return {
        title: `Start ${title} at ${zone.clock(next.start)}`,
        rationale: `First goal block tomorrow: ${toMin(next.end - next.start)} minutes for ${next.goal.title}.${top ? ` Put ${top.name} away before it starts.` : ""}`,
        action_kind: "reminder",
        start_at: iso(next.start),
        end_at: iso(next.end),
        goal_id: next.goal.id,
      };
    }
    return bookGap(tomorrow, tomorrowStart, " tomorrow");
  }
}

/** The headline without a model. Numbers only from the core. */
export function templateHeadline(m: MomentCore): string {
  const t = m.totals;
  if (m.kind === "morning") {
    const risk = m.at_risk;
    const tz = new Zone(m.timezone);
    const guard = risk
      ? ` Guard ${tz.clock(Date.parse(risk.start_at))} to ${tz.clock(Date.parse(risk.end_at))}: it usually costs ${duration(risk.expected_lost_minutes)}.`
      : "";
    if (t.planned_minutes > 0) return `Today holds ${duration(t.planned_minutes)} of goal time.${guard}`;
    const move = m.suggestions.find((s) => s.action_kind === "create_focus_block");
    return `Nothing booked for your goals today.${move ? ` ${move.title}.` : guard}`;
  }
  const lost = t.lost_minutes > 0 ? `${duration(t.lost_minutes)} lost` : "nothing lost";
  const won = t.won_back_minutes > 0 ? ` ${duration(t.won_back_minutes)} won back on your usual day.` : "";
  if (t.planned_minutes > 0)
    return `${duration(t.spent_minutes)} of ${duration(t.planned_minutes)} planned goal time held, ${lost}.${won}`;
  return t.lost_minutes > 0
    ? `No goal time booked today, ${duration(t.lost_minutes)} lost to interruptions.${won}`
    : "No goal time booked today. Book tomorrow before you sleep.";
}
