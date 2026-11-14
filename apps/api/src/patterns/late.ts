import type { LateScreens, PatternSubject } from "@michael/shared";
import { type Ctx, daysTouched, RULES } from "./context";
import { type Detector, found, notEnough } from "./detector";
import { clockLabel, duration, label } from "./format";
import { MINUTE } from "./time";
import { type Segment, subjectOf } from "./timeline";
import { iso, lowerBound, median, mins, round1, subjectId, sum } from "./util";

const LATE_MINIMUM =
  "at least 3 nights inside the range on days with device data; usual bedtime needs 3 recorded sleeps of 3 hours or more; the recovery comparison needs 3 late and 3 other nights";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Device use after the cut off, night by night. The cut off is 23:00, or one hour before the usual
 * bedtime (the median start of recorded sleeps) when sleep data exists. A night runs for 6 hours
 * from the cut off and belongs to the local day its evening is on.
 */
export function lateScreens(ctx: Ctx): Detector<LateScreens> {
  const { zone, tl } = ctx;

  let cutoff: number = RULES.lateCutoffMinutes;
  let bedtime: number | null = null;
  const mainSleeps = ctx.sleeps.filter((s) => s.end - s.start >= RULES.mainSleepMs);
  if (mainSleeps.length >= RULES.minSleepsForBedtime) {
    // Measured from noon so that 23:40 and 00:30 sit next to each other.
    const afterNoon = mainSleeps.map((s) => (zone.minuteOfDay(s.start) - 720 + 1440) % 1440);
    bedtime = 720 + Math.round(median(afterNoon));
    cutoff = bedtime - 60;
  }

  const withData = daysTouched(ctx, tl.attention);
  const recoveries = ctx.events
    .filter((e) => e.type === "recovery")
    .map((e) => ({ at: Date.parse(e.start_at), pct: num(e.data.recovery_pct) }))
    .sort((a, b) => a.at - b.at);

  interface Night {
    day: string;
    segs: Segment[];
    ms: number;
  }
  const nights: Night[] = [];
  for (const d of ctx.days) {
    const start = zone.at(d.day, cutoff);
    const end = zone.at(d.day, cutoff + RULES.nightLengthMinutes);
    if (start < ctx.from || end > ctx.to || !withData.has(d.day)) continue;
    const segs: Segment[] = [];
    for (let i = Math.max(0, lowerBound(tl.attention, start) - 1); i < tl.attention.length; i++) {
      const s = tl.attention[i];
      if (!s || s.start >= end) break;
      if (s.end <= start) continue;
      segs.push({ ...s, start: Math.max(s.start, start), end: Math.min(s.end, end) });
    }
    nights.push({ day: d.day, segs, ms: sum(segs.map((s) => s.end - s.start)) });
  }
  if (nights.length < RULES.minNights) {
    return notEnough(
      LATE_MINIMUM,
      `needs at least ${RULES.minNights} nights with device data, found ${nights.length}`,
    );
  }

  const topOf = (segs: Segment[]) => {
    const totals = new Map<string, { subject: PatternSubject; ms: number }>();
    for (const s of segs) {
      const subject = subjectOf(s);
      const entry = totals.get(subjectId(subject));
      if (entry) entry.ms += s.end - s.start;
      else totals.set(subjectId(subject), { subject, ms: s.end - s.start });
    }
    return [...totals.values()].sort((a, b) => b.ms - a.ms)[0] ?? null;
  };

  const rows = nights.map((n) => {
    const next = zone.nextDay(n.day);
    const recovery = recoveries.find((r) => r.pct !== null && zone.dayOf(r.at) === next);
    const sleep = mainSleeps.find((s) => zone.dayOf(s.end) === next);
    const top = topOf(n.segs);
    const last = n.segs[n.segs.length - 1];
    return {
      night: n.day,
      minutes: mins(n.ms),
      mac_minutes: mins(sum(n.segs.filter((s) => s.device === "mac").map((s) => s.end - s.start))),
      iphone_minutes: mins(sum(n.segs.filter((s) => s.device === "iphone").map((s) => s.end - s.start))),
      top: top?.subject ?? null,
      top_minutes: mins(top?.ms ?? 0),
      last_seen_at: last ? iso(last.end) : null,
      next_recovery_pct: recovery?.pct ?? null,
      next_sleep_minutes: sleep ? round1((sleep.end - sleep.start) / MINUTE) : null,
    };
  });

  const late = nights.filter((n) => n.ms >= RULES.minLateMs);
  const withRecovery = rows.filter((r) => r.next_recovery_pct !== null);
  const lateSide = withRecovery.filter((r) => r.minutes * MINUTE >= RULES.lateNightForComparisonMs);
  const otherSide = withRecovery.filter((r) => r.minutes * MINUTE < RULES.lateNightForComparisonMs);
  const avg = (list: typeof rows) => round1(sum(list.map((r) => r.next_recovery_pct ?? 0)) / list.length);
  const comparison =
    lateSide.length >= RULES.minComparisonNights && otherSide.length >= RULES.minComparisonNights
      ? {
          late_nights: lateSide.length,
          late_avg_recovery_pct: avg(lateSide),
          other_nights: otherSide.length,
          other_avg_recovery_pct: avg(otherSide),
        }
      : null;

  const data: LateScreens = {
    cutoff: clockLabel(cutoff),
    cutoff_source: bedtime === null ? "default" : "usual_bedtime",
    usual_bedtime: bedtime === null ? null : clockLabel(bedtime),
    nights_observed: nights.length,
    late_nights: late.length,
    median_late_minutes: late.length > 0 ? round1(median(late.map((n) => n.ms / MINUTE))) : null,
    nights: rows,
    recovery_comparison: comparison,
  };

  const parts: string[] = [];
  if (late.length === 0) {
    parts.push(`No screen use after ${data.cutoff} on any of ${nights.length} nights.`);
  } else {
    parts.push(
      `Screens on after ${data.cutoff} on ${late.length} of ${nights.length} nights, a median of ${duration(data.median_late_minutes ?? 0)}.`,
    );
    const top = topOf(late.flatMap((n) => n.segs));
    if (top) parts.push(`Most used then: ${label(top.subject)}.`);
  }
  if (comparison) {
    parts.push(
      `Recovery the next morning: ${Math.round(comparison.late_avg_recovery_pct)}% after nights with 30 minutes or more of late screens, ${Math.round(comparison.other_avg_recovery_pct)}% after the others.`,
    );
  }
  const evidence = [...late].reverse().flatMap((n) =>
    [...n.segs]
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, 3)
      .map((s) => s.eventId),
  );
  return found(LATE_MINIMUM, parts.join(" "), evidence, data);
}
