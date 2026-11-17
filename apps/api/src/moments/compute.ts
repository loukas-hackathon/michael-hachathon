import {
  budgetMinutesDone,
  type Event,
  type Goal,
  goalArea,
  goalKind,
  isSleepGoal,
  type Moment,
  type MomentGoal,
  type MomentKind,
  type MomentMove,
  type MomentStretch,
  type ScoreBlock,
  type ScoreLostStretch,
  voiceDuration,
} from "@michael/shared";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { goalBlocks } from "../patterns/focus";
import { count, siteName } from "../patterns/format";
import { DAY, MINUTE, Zone } from "../patterns/time";
import { iso, type Span, sum, union } from "../patterns/util";
import { isTrainingGoal } from "../score/purpose";
import { scoreRange, scoreWithHistory } from "../score/score";
import { sleepGoalMinutes } from "../score/week";

// Morning and Evening moments, computed. Pure: events, goals and the clock come in, numbers come
// out. Only the headline may later be phrased by a model (phrase.ts); everything else is here.
//
// ONE SOURCE: every minute here is the score's (score/score.ts). The goal lines are the score's
// goal rows, today's totals are the score's day, and what a block lost before today is what the
// score counted inside that block. The Goals screen reads the same rows, so the two never differ.

/** Days before today that set the usual stretch (what a block in these hours loses). */
export const HISTORY_DAYS = 7;
/** A stretch is worth a line only when it stands to lose at least this much. */
export const MIN_STAKE_MINUTES = 10;
/** A block Michael offers to book today starts at least this long after now. */
export const BOOK_LEAD_MINUTES = 15;
/** Free time a suggested block may use, local wall clock. */
const DAY_OPENS = 8 * 60;
const DAY_CLOSES = 21 * 60;
const MIN_SLOT = 30;
const MAX_SLOT = 90;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The events a moment needs: what the score needs for today (its week and the 28 days before it,
 * for the usual loss rate), to the end of tomorrow when tomorrow is already next week.
 */
export function momentRange(now: string, timezone = DEFAULT_TIMEZONE): { from: string; to: string } {
  const zone = new Zone(timezone);
  const today = zone.dayOf(Date.parse(now));
  const range = scoreRange(today, timezone);
  return {
    from: iso(range.from),
    to: iso(Math.max(range.to, zone.startOfDay(zone.nextDay(today, 2)))),
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

/** What took the time, by the name a person would use: an app, or a site by its product name. */
interface Trigger {
  name: string;
  minutes: number;
  count: number;
  device: "mac" | "iphone";
  kind: "app" | "site";
}

/** Lost stretches summed by what took them, most first. */
function triggers(stretches: ScoreLostStretch[]): Trigger[] {
  const by = new Map<string, Trigger>();
  for (const s of stretches) {
    const name = s.kind === "site" ? siteName(s.what) : s.what;
    const cur = by.get(name);
    if (cur) {
      cur.minutes += s.minutes;
      cur.count += 1;
    } else by.set(name, { name, minutes: s.minutes, count: 1, device: s.device, kind: s.kind });
  }
  return [...by.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

/**
 * "Yesterday this block lost 24 minutes to Instagram." The last time the same block ran, in words.
 * Null when the stretch has no last time. `block` names the block where the line stands alone.
 */
export function lastTimeLine(risk: MomentStretch, today: string, block = "this block"): string | null {
  const last = risk.last_time;
  if (!last) return null;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  const when =
    last.day === yesterday ? "Yesterday" : `On ${WEEKDAYS[new Date(`${last.day}T00:00:00Z`).getUTCDay()]}`;
  return `${when} ${block} lost ${voiceDuration(last.lost_minutes)}${last.trigger ? ` to ${last.trigger}` : ""}.`;
}

/** How a line that stands alone names the block at risk: by its start, or "this block" once it is running. */
export function riskBlockName(m: Pick<MomentCore, "generated_at" | "timezone">, risk: MomentStretch): string {
  if (risk.start_at === m.generated_at) return "this block";
  return `the ${new Zone(m.timezone).clock(Date.parse(risk.start_at))} block`;
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
  const weekEnd = zone.startOfDay(zone.nextDay(today, 7 - weekday));
  const historyStart = zone.startOfDay(zone.nextDay(today, -HISTORY_DAYS));
  const daysLeft = 7 - weekday;
  const { events } = input;
  const goals = input.goals.filter((g) => g.active);
  const goalById = new Map(goals.map((g) => [g.id, g]));

  // The score for today: its goal rows, its day, and every block part it counted before today.
  const { score, blocks } = scoreWithHistory(events, goals, { date: today, now: input.now, timezone });
  const day = score.day;
  const rows = new Map(score.goals.map((g) => [g.goal_id, g]));

  const goalLines: MomentGoal[] = [];
  for (const g of goals) {
    const row = rows.get(g.id);
    if (!row) continue;
    if (g.weekly_budget_minutes === null && row.planned_minutes === 0) continue;
    const base = {
      goal_id: g.id,
      title: g.title,
      category: g.category,
      area: goalArea(g.category),
      kind: goalKind(g),
      budget_minutes: g.weekly_budget_minutes,
    };
    // Sleep: a health goal of kind `target` that describes sleep (an older `rest` goal reads as
    // one). The score keeps it outside its totals and reports the nights apart (`sleep`).
    if (isSleepGoal(g)) {
      const perNight = score.sleep?.goal_minutes ?? sleepGoalMinutes(g) ?? 0;
      const nights = score.sleep?.nightly ?? [];
      goalLines.push({
        ...base,
        sleep: true,
        spent_week_minutes: sum(nights.map((n) => n ?? 0)),
        planned_today_minutes: perNight,
        spent_today_minutes: nights[weekday] ?? 0,
        lost_today_minutes: 0,
        planned_ahead_minutes: toMin(((perNight * Math.max(0, weekEnd - now)) / DAY) * MINUTE),
        // Sleep is not booked, so it has no unplanned time.
        unplanned_minutes: null,
      });
      continue;
    }
    const todayRow = row.daily.find((d) => d.date === today);
    goalLines.push({
      ...base,
      sleep: false,
      // Against the budget: spent in blocks plus logged outside them (#372).
      spent_week_minutes: budgetMinutesDone(row),
      planned_today_minutes: todayRow?.planned_minutes ?? 0,
      spent_today_minutes: todayRow?.spent_minutes ?? 0,
      lost_today_minutes: sum(day.blocks.filter((b) => b.goal_id === g.id).map((b) => b.lost_minutes)),
      planned_ahead_minutes: row.ahead_minutes,
      // Only a goal measured in planned minutes has time left to book.
      unplanned_minutes:
        g.weekly_budget_minutes === null || !row.scored
          ? null
          : Math.max(0, g.weekly_budget_minutes - budgetMinutesDone(row) - row.ahead_minutes),
    });
  }

  // Today is the score's day: held plus lost is what has elapsed, never more than planned.
  const planned = day.planned_minutes;
  const spentToday = day.spent_minutes;
  const lostToday = day.lost_minutes;
  // Won back is the score's too: what the elapsed blocks usually lose, less what they lost today.
  // The usual loss is the score's usual rate over today's blocks: in the morning over all that is
  // planned (what today stands to lose), in the evening over what has elapsed (what won back is
  // measured against).
  const usual = day.time_won_back;
  const wonBack = input.kind === "evening" ? usual.minutes : 0;
  const baseline =
    usual.usual_loss_rate === null
      ? null
      : input.kind === "morning"
        ? Math.round(usual.usual_loss_rate * planned)
        : wonBack > 0
          ? wonBack + lostToday
          : Math.round(usual.usual_loss_rate * day.elapsed_minutes);

  // The biggest gap in the week, for a suggestion or tomorrow's first move.
  const gap = goalLines
    .filter((l) => !l.sleep && (l.unplanned_minutes ?? 0) > 0)
    .sort((a, b) => (b.unplanned_minutes ?? 0) - (a.unplanned_minutes ?? 0))[0];
  const busyOn = (a: number, z: number): Span[] =>
    events
      .filter((e) => e.type === "calendar_event" && e.end_at)
      .map((e) => ({ start: Date.parse(e.start_at), end: Date.parse(e.end_at as string) }))
      .filter((s) => s.end > a && s.start < z);
  /** Book the goal with the most unplanned budget on `onDay`, in the first free slot from `after`. */
  const bookGap = (onDay: string, after: number, when: string): MomentMove | null => {
    if (!gap) return null;
    const minutes = slotLength(gap.unplanned_minutes ?? 0, daysLeft);
    const dayStart = zone.startOfDay(onDay);
    const from = Math.max(after, zone.at(onDay, DAY_OPENS));
    const to = zone.at(onDay, DAY_CLOSES);
    const slot =
      to > from ? freeSlot(busyOn(dayStart, zone.startOfDay(zone.nextDay(onDay))), from, to, minutes) : null;
    const budget = gap.budget_minutes ?? 0;
    const left = Math.max(0, budget - gap.spent_week_minutes);
    // The goal by its own name: "Book 90 minutes for University", never "deep work".
    const what = `${voiceDuration(minutes)} for ${gap.title}`;
    return {
      title: slot ? `Book ${what} at ${zone.clock(slot.start)}${when}` : `Find ${what}${when}`,
      rationale:
        gap.planned_ahead_minutes > 0
          ? `${voiceDuration(left)} of ${voiceDuration(budget)} for ${gap.title} left this week and ${voiceDuration(gap.planned_ahead_minutes)} planned, so ${voiceDuration(gap.unplanned_minutes ?? 0)} is not booked.`
          : `${voiceDuration(left)} of ${voiceDuration(budget)} for ${gap.title} left this week and none of it booked.`,
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
    const suggestions: MomentMove[] = [];
    if (risk?.trigger) {
      const s = Date.parse(risk.stretch.start_at);
      const e = Date.parse(risk.stretch.end_at);
      const hours = `from ${zone.clock(s)} to ${zone.clock(e)}`;
      const t = risk.trigger;
      // A phone goes to another room, a Mac app can be closed for the block, a site is the user's to close.
      const onPhone = t.device === "iphone";
      const isApp = t.kind === "app";
      suggestions.push({
        title: onPhone
          ? `Phone in another room ${hours}`
          : isApp
            ? `Silence ${t.name} ${hours}`
            : `Keep ${t.name} closed ${hours}`,
        rationale:
          lastTimeLine(risk.stretch, today) ??
          `Goal blocks in these hours usually lose ${voiceDuration(risk.stretch.expected_lost_minutes)}, mostly to ${t.name} (${count(risk.stretch.history_days, "day")} with a block in the last ${HISTORY_DAYS}).`,
        action_kind: !onPhone && isApp ? "block_mac_app" : "reminder",
        start_at: risk.stretch.start_at,
        end_at: risk.stretch.end_at,
        goal_id: risk.stretch.goal_id,
      });
    }
    // Never a block that starts the minute it is shown: 15 minutes ahead, on the next quarter.
    const lead = now + BOOK_LEAD_MINUTES * MINUTE;
    const leadMinute = zone.minuteOfDay(lead) + (lead % MINUTE > 0 ? 1 : 0);
    const earliest =
      zone.dayOf(lead) === today ? zone.at(today, Math.ceil(leadMinute / 15) * 15) : tomorrowStart;
    const book = bookGap(today, earliest, "");
    if (book) suggestions.push(book);
    return { ...base, at_risk: risk?.stretch ?? null, suggestions, lesson: null, first_move: null };
  }

  return { ...base, at_risk: null, suggestions: [], lesson: lesson(), first_move: firstMove() };

  // ---------- morning: the block most likely to lose time ----------

  /**
   * Of today's blocks still ahead, the one with the most at stake. Training blocks are left out
   * (nobody silences mail for a swim), and so is any block that stands to lose under 10 minutes.
   * With nothing left there is no line and no move.
   *
   * The stake of a block is what the same block lost the last time it ran (same title, or same
   * goal at the same hour) when that was 10 minutes or more, else the average over the history
   * days that had a goal block in those hours. A day with no block there is not in the average.
   */
  function atRisk(): { stretch: MomentStretch; trigger: Trigger | null } | null {
    interface Past extends Span {
      day: string;
      block: ScoreBlock;
    }
    const past: Past[] = [];
    for (const block of blocks) {
      const start = Date.parse(block.start_at);
      const goal = goalById.get(block.goal_id);
      if (start < historyStart || start >= todayStart || !goal || isTrainingGoal(goal)) continue;
      // The user's word is not a distraction: time they logged themselves is no planned block, and
      // a block they settled ("did it", "didn't") has the minutes they said, not what took them.
      if (block.matched_by === "logged" || block.settled) continue;
      past.push({ start, end: Date.parse(block.end_at), day: zone.dayOf(start), block });
    }
    const historyDays = Array.from({ length: HISTORY_DAYS }, (_, i) => zone.nextDay(today, -(i + 1)));

    let best: { stake: number; stretch: MomentStretch; trigger: Trigger | null } | null = null;
    for (const block of day.blocks) {
      const goal = goalById.get(block.goal_id);
      const blockStart = Date.parse(block.start_at);
      const end = Date.parse(block.end_at);
      if (!goal || isTrainingGoal(goal) || end <= now || block.matched_by === "logged") continue;
      const start = Math.max(blockStart, now);
      const length = end - start;
      const offset = zone.minuteOfDay(start);

      // The same hours on each history day that had a goal block over at least half of them.
      let blockDays = 0;
      let lost = 0;
      const stretches: ScoreLostStretch[] = [];
      for (const d of historyDays) {
        const a = zone.at(d, offset);
        const z = a + length;
        const parts = past.filter((p) => p.day === d && p.end > a && p.start < z);
        const covered = sum(parts.map((p) => Math.min(p.end, z) - Math.max(p.start, a)));
        if (covered * 2 < length) continue;
        blockDays++;
        for (const p of parts) {
          const inside = p.block.lost.filter((s) => {
            const at = Date.parse(s.start_at);
            return at >= a && at < z;
          });
          stretches.push(...inside);
          // A block wholly inside these hours counts with the minutes the score shows for it.
          lost += p.start >= a && p.end <= z ? p.block.lost_minutes : sum(inside.map((s) => s.minutes));
        }
      }
      const expected = blockDays > 0 ? Math.round(lost / blockDays) : 0;

      // The same block, the last time it ran.
      const same = past
        .filter(
          (p) =>
            sameTitle(p.block.title, block.title) ||
            (p.block.goal_id === block.goal_id && zone.hourOf(p.start) === zone.hourOf(blockStart)),
        )
        .sort((a, b) => b.start - a.start)[0];
      const lastTrigger = same ? (triggers(same.block.lost)[0] ?? null) : null;
      const last =
        same && same.block.lost_minutes >= MIN_STAKE_MINUTES
          ? { day: same.day, lost_minutes: same.block.lost_minutes, trigger: lastTrigger?.name ?? null }
          : null;

      const stake = Math.max(expected, last?.lost_minutes ?? 0);
      if (stake < MIN_STAKE_MINUTES) continue;
      if (best && best.stake >= stake) continue;
      const usualTrigger = triggers(stretches)[0] ?? null;
      best = {
        stake,
        // The move follows what Michael quotes: last time's trigger when he quotes last time.
        trigger: (last ? lastTrigger : null) ?? usualTrigger ?? lastTrigger,
        stretch: {
          start_at: iso(start),
          end_at: iso(end),
          title: block.title,
          goal_id: block.goal_id,
          block_event_id: block.event_id,
          expected_lost_minutes: expected,
          history_days: blockDays,
          usual_trigger: (usualTrigger ?? lastTrigger)?.name ?? null,
          last_time: last,
        },
      };
    }
    return best;
  }

  // ---------- evening: one lesson and tomorrow's first move ----------

  /** What took the most time inside today's goal blocks, as the score counted it. */
  function topTriggerToday(): Trigger | null {
    const top = triggers(day.blocks.flatMap((b) => b.lost))[0];
    return top && Math.round(top.minutes) >= 1 ? top : null;
  }

  function lesson(): string {
    const top = topTriggerToday();
    if (top) {
      const n = top.count === 1 ? "1 interruption" : `${top.count} interruptions`;
      return `${top.name} cost ${voiceDuration(Math.round(top.minutes))} in ${n} today.`;
    }
    // The person's own goal by name, never a general rule (the same line every empty evening).
    if (planned === 0)
      return gap
        ? `No goal blocks today. ${gap.title} has ${voiceDuration(gap.unplanned_minutes ?? 0)} unbooked this week.`
        : "No goal blocks today. Time you do not book goes elsewhere.";
    if (lostToday > 0) return `${voiceDuration(lostToday)} of planned goal time lost today.`;
    if (day.ahead_minutes > 0)
      return `Nothing lost so far. ${voiceDuration(day.ahead_minutes)} of goal time still ahead today.`;
    const held = goalLines
      .filter((l) => !l.sleep && l.spent_today_minutes > 0)
      .sort((a, b) => b.spent_today_minutes - a.spent_today_minutes)[0];
    return held
      ? `Every planned minute held. ${held.title} got ${voiceDuration(held.spent_today_minutes)} of it.`
      : "Every planned minute held. Book tomorrow the same way.";
  }

  function firstMove(): MomentMove | null {
    const next = goalBlocks(events, goals, tomorrowStart, dayAfterStart).sort((a, b) => a.start - b.start)[0];
    if (next) {
      const top = topTriggerToday();
      return {
        title: `Start ${next.title || next.goal.title} at ${zone.clock(next.start)}`,
        rationale: `First goal block tomorrow: ${voiceDuration(toMin(next.end - next.start))} for ${next.goal.title}.${top ? ` Put ${top.name} away before it starts.` : ""}`,
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
    const from = risk ? tz.clock(Date.parse(risk.start_at)) : "";
    // The stake: what this block lost last time when there is one, else what these hours usually cost.
    const guard = risk
      ? ` ${
          lastTimeLine(risk, m.day, riskBlockName(m, risk)) ??
          `Guard ${from} to ${tz.clock(Date.parse(risk.end_at))}: it usually costs ${voiceDuration(risk.expected_lost_minutes)}.`
        }`
      : "";
    if (t.planned_minutes > 0) return `Today holds ${voiceDuration(t.planned_minutes)} of goal time.${guard}`;
    const move = m.suggestions.find((s) => s.action_kind === "create_focus_block");
    return `Nothing booked for your goals today.${move ? ` ${move.title}.` : guard}`;
  }
  // Evening. Held plus lost is what has elapsed; with what is still ahead they make the plan.
  if (t.planned_minutes === 0) {
    // The goal with the most budget still unbooked, by name: an empty evening is never generic.
    const open = m.goals
      .filter((g) => !g.sleep && (g.unplanned_minutes ?? 0) > 0)
      .sort((a, b) => (b.unplanned_minutes ?? 0) - (a.unplanned_minutes ?? 0))[0];
    return open
      ? `No goal time today. ${open.title} has ${voiceDuration(open.unplanned_minutes ?? 0)} left to book.`
      : "No goal time today. Put tomorrow's in before bed.";
  }
  const ahead = Math.max(0, t.planned_minutes - t.spent_minutes - t.lost_minutes);
  if (ahead === t.planned_minutes)
    return `${voiceDuration(t.planned_minutes)} of goal time still ahead today.`;
  const won =
    t.won_back_minutes > 0 ? ` ${voiceDuration(t.won_back_minutes)} won back against your usual day.` : "";
  // A clean day is a real win: say it once, with the number.
  if (t.lost_minutes === 0 && ahead === 0)
    return `All ${voiceDuration(t.planned_minutes)} of planned goal time held, nothing lost.${won}`;
  const lost = t.lost_minutes > 0 ? `${voiceDuration(t.lost_minutes)} got away` : "nothing lost";
  const rest = ahead > 0 ? `, ${voiceDuration(ahead)} still ahead` : "";
  // Nothing held is a fact and a plan, never a telling off.
  if (t.spent_minutes === 0)
    return `We didn't get to the ${voiceDuration(t.planned_minutes)} of goal time today${rest}.`;
  return `You held ${voiceDuration(t.spent_minutes)} of ${voiceDuration(t.planned_minutes)} planned goal time. ${lost.charAt(0).toUpperCase()}${lost.slice(1)}${rest}.${won}`;
}
