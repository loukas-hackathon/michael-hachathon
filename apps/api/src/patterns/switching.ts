import type { ContextSwitching } from "@michael/shared";
import { type Ctx, daysTouched, RULES } from "./context";
import { type Detector, found, notEnough } from "./detector";
import { duration, pct, rate } from "./format";
import { HOUR } from "./time";
import type { Segment } from "./timeline";
import { add, median, mins, ratio, round1, round2, type Span } from "./util";

export interface Stay extends Span {
  appKey: string;
  eventId: string;
}

/**
 * A stay is unbroken time in one app (on one device). Intervals of the same app less than 5
 * seconds apart are one stay; all sites count as the browser, so moving between tabs is not a
 * switch.
 */
export function stays(attention: Segment[]): Stay[] {
  const out: Stay[] = [];
  for (const seg of attention) {
    const last = out[out.length - 1];
    if (last && last.appKey === seg.appKey && seg.start - last.end <= RULES.stayJoinMs) last.end = seg.end;
    else out.push({ start: seg.start, end: seg.end, appKey: seg.appKey, eventId: seg.eventId });
  }
  return out;
}

const SWITCH_MINIMUM =
  "at least 60 minutes of active device time in the range; a day needs 30 active minutes for its own rate";

export function contextSwitching(ctx: Ctx): Detector<ContextSwitching> {
  const { zone } = ctx;
  const list = stays(ctx.tl.attention);
  const activeByDay = new Map<string, number>();
  const fragmentByDay = new Map<string, number>();
  const switchesByDay = new Map<string, number>();
  let activeMs = 0;
  let fragmentMs = 0;
  let switches = 0;

  for (let i = 0; i < list.length; i++) {
    const stay = list[i];
    if (!stay) continue;
    const ms = stay.end - stay.start;
    const fragment = ms < RULES.fragmentMs;
    activeMs += ms;
    if (fragment) fragmentMs += ms;
    for (const p of zone.splitByDay(stay.start, stay.end)) {
      add(activeByDay, p.day, p.end - p.start);
      if (fragment) add(fragmentByDay, p.day, p.end - p.start);
    }
    // A switch is a move to a different app with no idle break in between.
    const prev = list[i - 1];
    if (prev && prev.appKey !== stay.appKey && stay.start - prev.end <= RULES.idleBreakMs) {
      switches++;
      add(switchesByDay, zone.dayOf(stay.start), 1);
    }
  }

  if (activeMs < RULES.minActiveMs) {
    return notEnough(
      SWITCH_MINIMUM,
      `needs at least ${(RULES.minActiveMs / HOUR) * 60} minutes of device time, found ${Math.round(mins(activeMs))}`,
    );
  }

  const withData = daysTouched(ctx, ctx.tl.attention);
  const daily = ctx.days
    .filter((d) => withData.has(d.day))
    .map((d) => {
      const active = activeByDay.get(d.day) ?? 0;
      const enough = active >= RULES.minActiveMsForRate;
      return {
        day: d.day,
        complete: d.complete,
        active_minutes: mins(active),
        switches: switchesByDay.get(d.day) ?? 0,
        switches_per_active_hour: enough ? round1((switchesByDay.get(d.day) ?? 0) / (active / HOUR)) : null,
        fragment_share: enough ? round2(ratio(fragmentByDay.get(d.day) ?? 0, active)) : null,
      };
    });

  const data: ContextSwitching = {
    days_with_data: withData.size,
    active_minutes: mins(activeMs),
    switches,
    switches_per_active_hour: round1(switches / (activeMs / HOUR)),
    fragment_share: round2(ratio(fragmentMs, activeMs)),
    median_stay_seconds: Math.round(median(list.map((s) => (s.end - s.start) / 1000))),
    daily,
  };
  const summary = [
    `${rate(data.switches_per_active_hour)} app switches per active hour.`,
    `${pct(data.fragment_share)} of screen time is spent in stays shorter than 2 minutes (median stay ${duration(data.median_stay_seconds / 60)}).`,
  ].join(" ");
  const evidence = list
    .filter((s) => s.end - s.start < RULES.fragmentMs)
    .slice(-RULES.evidenceCap)
    .reverse()
    .map((s) => s.eventId);
  return found(SWITCH_MINIMUM, summary, evidence, data);
}
