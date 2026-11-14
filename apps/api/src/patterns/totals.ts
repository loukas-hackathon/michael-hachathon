import type { AppCategory, PatternDevice, PatternSubject, TimeByApp, TimeTotals } from "@michael/shared";
import { type Ctx, countedDays, daysTouched } from "./context";
import { type Detector, found, notEnough } from "./detector";
import { days as dayCount, duration } from "./format";
import { type Segment, subjectOf } from "./timeline";
import { add, ratio, round1, secs, sum } from "./util";

const TOTALS_MINIMUM = "any Mac or iPhone app usage in the range";

interface Piece {
  seg: Segment;
  ms: number;
}

function totalsOf(pieces: Piece[], macAloneMs: number, topN: number): TimeTotals {
  const byCategory = new Map<AppCategory, number>();
  const byApp = new Map<string, { subject: PatternSubject; device: PatternDevice; ms: number }>();
  let mac = 0;
  let iphone = 0;
  for (const { seg, ms } of pieces) {
    add(byCategory, seg.category, ms);
    if (seg.device === "mac") mac += ms;
    else iphone += ms;
    const key = `${seg.device}:${seg.kind}:${seg.key}`;
    const entry = byApp.get(key);
    if (entry) entry.ms += ms;
    else byApp.set(key, { subject: subjectOf(seg), device: seg.device, ms });
  }
  const apps = [...byApp.values()].sort((a, b) => b.ms - a.ms);
  const shown = apps.slice(0, topN);
  return {
    active_seconds: secs(mac + iphone),
    mac_seconds: secs(mac),
    iphone_seconds: secs(iphone),
    overlap_seconds: secs(Math.max(0, macAloneMs - mac)),
    by_category: [...byCategory.entries()]
      .map(([category, ms]) => ({ category, seconds: secs(ms) }))
      .sort((a, b) => b.seconds - a.seconds),
    apps: shown.map((a) => ({ subject: a.subject, device: a.device, seconds: secs(a.ms) })),
    other_apps_seconds: secs(sum(apps.slice(topN).map((a) => a.ms))),
  };
}

/**
 * Time by app and by category per local day. Built from the single line of attention, so every
 * second is counted once: per day, the apps add up to the categories, which add up to the active
 * time. Intervals that cross midnight are cut at local midnight.
 */
export function timeByApp(ctx: Ctx): Detector<TimeByApp> {
  const { zone, tl } = ctx;
  if (tl.attention.length === 0) return notEnough(TOTALS_MINIMUM, "no Mac or iPhone usage in this range");

  const byDay = new Map<string, Piece[]>();
  const all: Piece[] = [];
  for (const seg of tl.attention) {
    all.push({ seg, ms: seg.end - seg.start });
    for (const p of zone.splitByDay(seg.start, seg.end)) {
      const list = byDay.get(p.day);
      const piece = { seg, ms: p.end - p.start };
      if (list) list.push(piece);
      else byDay.set(p.day, [piece]);
    }
  }
  const macAloneByDay = new Map<string, number>();
  for (const seg of tl.mac) {
    for (const p of zone.splitByDay(seg.start, seg.end)) add(macAloneByDay, p.day, p.end - p.start);
  }

  const withData = daysTouched(ctx, tl.attention);
  const daily = ctx.days
    .filter((d) => byDay.has(d.day))
    .map((d) => ({
      day: d.day,
      complete: d.complete,
      ...totalsOf(byDay.get(d.day) ?? [], macAloneByDay.get(d.day) ?? 0, 10),
    }));
  const totals = totalsOf(all, sum(tl.mac.map((s) => s.end - s.start)), 15);

  const counted = new Set(countedDays(ctx, withData));
  const rows = daily.filter((d) => counted.has(d.day));
  const perDay = (pick: (d: (typeof rows)[number]) => number) => ratio(sum(rows.map(pick)), rows.length) / 60;
  const data: TimeByApp = {
    days_with_data: withData.size,
    active_minutes_per_day: round1(perDay((d) => d.active_seconds)),
    totals,
    daily,
  };

  const categoryPerDay = new Map<AppCategory, number>();
  for (const d of rows)
    for (const c of d.by_category) add(categoryPerDay, c.category, c.seconds / 60 / rows.length);
  const topCategories = [...categoryPerDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const devices = [`Mac ${duration(perDay((d) => d.mac_seconds))}`];
  if (totals.iphone_seconds > 0) devices.push(`iPhone ${duration(perDay((d) => d.iphone_seconds))}`);
  const summary = [
    `Screen time ${duration(data.active_minutes_per_day)} a day over ${dayCount(rows.length)} (${devices.join(", ")}).`,
    `Most of it: ${topCategories.map(([c, m]) => `${c} ${duration(m)}`).join(", ")} a day.`,
  ].join(" ");
  const evidence = [...tl.attention]
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 20)
    .map((s) => s.eventId);
  return found(TOTALS_MINIMUM, summary, evidence, data);
}
