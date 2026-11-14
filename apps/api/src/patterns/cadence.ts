import type { MacAppCadence, PatternSubject, PhoneCadence } from "@michael/shared";
import { type Ctx, countedDays, RULES } from "./context";
import { type Detector, found, notEnough } from "./detector";
import { count, duration, hourLabel, pct, rate } from "./format";
import { MINUTE } from "./time";
import { notifiedBefore, type Segment, subjectOf } from "./timeline";
import { add, median, mins, quantile, ratio, round1, round2, type Span, subjectId } from "./util";

// ---------- phone sessions ----------

export interface PhoneSession extends Span {
  segments: Segment[];
  /** The first app that is not the system itself (home screen, lock screen). Null when there is none. */
  first: Segment | null;
}

/**
 * A phone session is one pick up: consecutive app intervals with less than 30 seconds between
 * them. Apple does not export pick ups, so this is our estimate from the app focus stream.
 */
export function phoneSessions(iphone: Segment[], gapMs: number = RULES.sessionGapMs): PhoneSession[] {
  const out: PhoneSession[] = [];
  for (const seg of iphone) {
    const last = out[out.length - 1];
    if (last && seg.start - last.end < gapMs) {
      last.end = Math.max(last.end, seg.end);
      last.segments.push(seg);
      if (!last.first && seg.category !== "system") last.first = seg;
    } else {
      out.push({
        start: seg.start,
        end: seg.end,
        segments: [seg],
        first: seg.category === "system" ? null : seg,
      });
    }
  }
  return out;
}

export interface Gap extends Span {
  /** False when the gap is sleep or time away and must not count as checking rhythm. */
  waking: boolean;
}

/**
 * Gaps between consecutive sessions, from the end of one to the start of the next. A gap is not
 * a waking gap when it overlaps a recorded sleep or is longer than 3 hours.
 */
export function sessionGaps(sessions: Span[], sleeps: Span[], awayGapMs: number = RULES.awayGapMs): Gap[] {
  const gaps: Gap[] = [];
  let s = 0;
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1];
    const cur = sessions[i];
    if (!prev || !cur) continue;
    const gap = { start: prev.end, end: cur.start };
    while (s < sleeps.length && (sleeps[s]?.end ?? 0) <= gap.start) s++;
    const sleep = sleeps[s];
    const asleep = sleep !== undefined && sleep.start < gap.end && sleep.end > gap.start;
    gaps.push({ ...gap, waking: !asleep && gap.end - gap.start <= awayGapMs });
  }
  return gaps;
}

const PHONE_MINIMUM =
  "at least 3 days of iPhone usage and 20 waking gaps between sessions; an hour needs 5 gaps, the working window 20";

export function phoneCadence(ctx: Ctx): Detector<PhoneCadence> {
  const { zone } = ctx;
  // Day and hour are worked out once per session and once per gap, then only grouped.
  const sessions = phoneSessions(ctx.tl.iphone).map((s) => ({
    ...s,
    day: zone.dayOf(s.start),
    hour: zone.hourOf(s.start),
  }));
  const withData = new Set(sessions.map((s) => s.day));
  if (withData.size < RULES.minPhoneDays) {
    return notEnough(
      PHONE_MINIMUM,
      `needs at least ${RULES.minPhoneDays} days of phone usage, found ${withData.size}`,
    );
  }
  const waking = sessionGaps(sessions, ctx.sleeps)
    .filter((g) => g.waking)
    .map((g) => ({
      minutes: (g.end - g.start) / MINUTE,
      day: zone.dayOf(g.start),
      hour: zone.hourOf(g.start),
    }));
  if (waking.length < RULES.minGaps) {
    return notEnough(
      PHONE_MINIMUM,
      `needs at least ${RULES.minGaps} waking gaps between phone sessions, found ${waking.length}`,
    );
  }

  const counted = countedDays(ctx, withData);
  const countedSet = new Set(counted);
  const inCounted = sessions.filter((s) => countedSet.has(s.day));
  const gapMinutes = waking.map((g) => g.minutes);

  // The working window, by local hour of the session start (or of the gap start).
  const inWindow = (hour: number) => hour >= ctx.workStartHour && hour < ctx.workEndHour;
  const windowGaps = waking.filter((g) => inWindow(g.hour)).map((g) => g.minutes);
  const windowMedian = windowGaps.length >= RULES.minGaps ? round1(median(windowGaps)) : null;

  const checks = sessions.filter((s) => s.end - s.start < RULES.checkMs);
  let notification = 0;
  let ownHand = 0;
  let unknown = 0;
  for (const s of sessions) {
    const opened = (s.first ?? s.segments[0])?.openedFrom ?? null;
    if (opened === "notification") notification++;
    else if (opened === "home_screen" || opened === "app_switcher") ownHand++;
    else unknown++;
  }

  const firstCounts = new Map<string, { app: PatternSubject; sessions: number }>();
  for (const s of sessions) {
    if (!s.first) continue;
    const app = subjectOf(s.first);
    const entry = firstCounts.get(subjectId(app));
    if (entry) entry.sessions++;
    else firstCounts.set(subjectId(app), { app, sessions: 1 });
  }
  const firstApps = [...firstCounts.values()]
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5)
    .map((f) => ({ ...f, share: round2(ratio(f.sessions, sessions.length)) }));

  const group = <T, K>(items: T[], key: (item: T) => K) => {
    const groups = new Map<K, T[]>();
    for (const item of items) {
      const list = groups.get(key(item));
      if (list) list.push(item);
      else groups.set(key(item), [item]);
    }
    return groups;
  };
  const sessionsByHour = group(sessions, (s) => s.hour);
  const countedByHour = group(inCounted, (s) => s.hour);
  const gapsByHour = group(waking, (g) => g.hour);
  const sessionsByDay = group(sessions, (s) => s.day);
  const gapsByDay = group(waking, (g) => g.day);

  const byHour = Array.from({ length: 24 }, (_, hour) => {
    const hourGaps = (gapsByHour.get(hour) ?? []).map((g) => g.minutes);
    return {
      hour,
      sessions: sessionsByHour.get(hour)?.length ?? 0,
      sessions_per_day: round1(ratio(countedByHour.get(hour)?.length ?? 0, counted.length)),
      median_gap_minutes: hourGaps.length >= RULES.minHourGaps ? round1(median(hourGaps)) : null,
    };
  });

  const daily = ctx.days
    .filter((d) => withData.has(d.day))
    .map((d) => {
      const daySessions = sessionsByDay.get(d.day) ?? [];
      const dayGaps = (gapsByDay.get(d.day) ?? []).map((g) => g.minutes);
      return {
        day: d.day,
        complete: d.complete,
        sessions: daySessions.length,
        checks: daySessions.filter((s) => s.end - s.start < RULES.checkMs).length,
        minutes: mins(daySessions.reduce((t, s) => t + (s.end - s.start), 0)),
        median_gap_minutes: dayGaps.length >= RULES.minDayGaps ? round1(median(dayGaps)) : null,
      };
    });

  const windowPerDay = ratio(inCounted.filter((s) => inWindow(s.hour)).length, counted.length);
  const windowLength = (ctx.workEndHour - ctx.workStartHour) * 60;

  const data: PhoneCadence = {
    days_with_data: withData.size,
    sessions: sessions.length,
    sessions_per_day: round1(ratio(inCounted.length, counted.length)),
    checks_share: round2(ratio(checks.length, sessions.length)),
    median_session_seconds: Math.round(median(sessions.map((s) => (s.end - s.start) / 1000))),
    gaps: waking.length,
    median_gap_minutes: round1(median(gapMinutes)),
    typical_gap_minutes: { p25: round1(quantile(gapMinutes, 0.25)), p75: round1(quantile(gapMinutes, 0.75)) },
    window: {
      start_hour: ctx.workStartHour,
      end_hour: ctx.workEndHour,
      sessions_per_day: round1(windowPerDay),
      average_interval_minutes: windowPerDay > 0 ? round1(windowLength / windowPerDay) : null,
      gaps: windowGaps.length,
      median_gap_minutes: windowMedian,
    },
    opened: {
      notification,
      own_hand: ownHand,
      unknown,
      notification_share: notification + ownHand > 0 ? round2(notification / (notification + ownHand)) : null,
    },
    first_apps: firstApps,
    by_hour: byHour,
    daily,
  };

  // Two honest readings of "how often": the average spacing over the window, and the median gap
  // (pick ups come in bursts, so the median is usually much shorter than the average).
  const parts: string[] = [];
  const between = `between ${hourLabel(ctx.workStartHour)} and ${hourLabel(ctx.workEndHour)}`;
  if (windowMedian !== null && data.window.average_interval_minutes !== null) {
    parts.push(
      `Phone picked up every ${duration(data.window.average_interval_minutes)} ${between}: ${rate(windowPerDay)} pickups a day in that window, median gap ${duration(windowMedian)}.`,
    );
  } else {
    parts.push(
      `Phone picked up ${rate(data.sessions_per_day)} times a day, median gap ${duration(data.median_gap_minutes)} while awake.`,
    );
  }
  const top = firstApps[0];
  if (top) parts.push(`${pct(top.share)} of pickups start with ${top.app.name}.`);
  parts.push(`${pct(data.checks_share)} last under 30 seconds.`);
  if (data.opened.notification_share !== null) {
    parts.push(`${pct(data.opened.notification_share)} were opened from a notification, the rest by hand.`);
  }

  // Proof: the first app of the most recent sessions.
  const evidence = sessions
    .slice(-RULES.evidenceCap)
    .reverse()
    .map((s) => (s.first ?? s.segments[0])?.eventId ?? "")
    .filter(Boolean);
  return found(PHONE_MINIMUM, parts.join(" "), evidence, data);
}

// ---------- the same rhythm per app on the Mac ----------

export interface MacVisit extends Span {
  appKey: string;
  subject: PatternSubject;
  bundle: string | null;
  eventId: string;
}

const BROWSER: PatternSubject = { kind: "app", key: "browser", name: "Browser", category: "other" };

/**
 * A visit is one time an app is brought to the front on the Mac: consecutive intervals of the
 * same app with less than 30 seconds between them and no other app in between. Intervals under
 * 3 seconds are passing through and are dropped first. Sites all count as the browser.
 */
export function macVisits(mac: Segment[]): MacVisit[] {
  const out: MacVisit[] = [];
  for (const seg of mac) {
    if (seg.end - seg.start < RULES.minVisitMs) continue;
    const last = out[out.length - 1];
    if (last && last.appKey === seg.appKey && seg.start - last.end < RULES.sessionGapMs) {
      last.end = seg.end;
      if (last.subject === BROWSER && seg.kind === "app") {
        last.subject = subjectOf(seg);
        last.bundle = seg.key;
      }
      continue;
    }
    out.push({
      start: seg.start,
      end: seg.end,
      appKey: seg.appKey,
      subject: seg.kind === "app" ? subjectOf(seg) : BROWSER,
      bundle: seg.kind === "app" ? seg.key : null,
      eventId: seg.eventId,
    });
  }
  return out;
}

const DISTRACTING = new Set(["communication", "social", "video", "news", "shopping", "travel"]);
const MAC_MINIMUM =
  "at least 3 days of Mac usage; an app needs 10 activations on 2 or more days, and 5 gaps for a median gap";

export function macAppCadence(ctx: Ctx): Detector<MacAppCadence> {
  const { zone, tl } = ctx;
  const withData = new Set<string>();
  for (const s of tl.mac) withData.add(zone.dayOf(s.start));
  if (withData.size < RULES.minMacDays) {
    return notEnough(
      MAC_MINIMUM,
      `needs at least ${RULES.minMacDays} days of Mac usage, found ${withData.size}`,
    );
  }
  const counted = countedDays(ctx, withData);
  const countedSet = new Set(counted);

  // Mac time in use before any instant, so a gap can be measured in minutes of Mac use: closing
  // the lid for the night does not turn into a 9 hour gap.
  const starts = tl.mac.map((s) => s.start);
  const before: number[] = [0];
  for (const s of tl.mac) before.push((before[before.length - 1] ?? 0) + (s.end - s.start));
  const activeBefore = (t: number) => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((starts[mid] ?? Number.POSITIVE_INFINITY) < t) lo = mid + 1;
      else hi = mid;
    }
    // `lo` segments start before t; the last of them may still be running at t.
    const done = before[lo] ?? 0;
    const running = tl.mac[lo - 1];
    return running && running.end > t ? done - (running.end - t) : done;
  };

  const byApp = new Map<string, MacVisit[]>();
  for (const v of macVisits(tl.mac)) {
    const list = byApp.get(v.appKey);
    if (list) list.push(v);
    else byApp.set(v.appKey, [v]);
  }
  const macMsByDay = new Map<string, number>();
  for (const seg of tl.mac) {
    for (const p of zone.splitByDay(seg.start, seg.end)) add(macMsByDay, p.day, p.end - p.start);
  }
  const countedMacMinutes = counted.reduce((t, d) => t + (macMsByDay.get(d) ?? 0), 0) / MINUTE;

  const rows = [...byApp.values()]
    .map((visits) => {
      const first = visits.find((v) => v.subject !== BROWSER) ?? visits[0];
      const days = new Set(visits.map((v) => zone.dayOf(v.start)));
      const gaps: number[] = [];
      for (let i = 1; i < visits.length; i++) {
        const prev = visits[i - 1];
        const cur = visits[i];
        if (prev && cur) gaps.push((activeBefore(cur.start) - activeBefore(prev.end)) / MINUTE);
      }
      const notified = visits.filter(
        (v) => v.bundle !== null && notifiedBefore(tl, v.bundle, v.start, RULES.notificationWindowMs),
      ).length;
      const perDay = new Map<string, number>();
      for (const v of visits) add(perDay, zone.dayOf(v.start), 1);
      const inCounted = counted.reduce((t, d) => t + (perDay.get(d) ?? 0), 0);
      return {
        visits,
        row: {
          app: first?.subject ?? BROWSER,
          activations: visits.length,
          days: days.size,
          activations_per_day: round1(ratio(inCounted, countedSet.size)),
          minutes_of_mac_use_per_activation: inCounted > 0 ? round1(countedMacMinutes / inCounted) : null,
          median_gap_active_minutes: gaps.length >= RULES.minAppGaps ? round1(median(gaps)) : null,
          checks_share: round2(
            ratio(visits.filter((v) => v.end - v.start < RULES.checkMs).length, visits.length),
          ),
          median_visit_seconds: Math.round(median(visits.map((v) => (v.end - v.start) / 1000))),
          // Unknown (null) unless the Mac logged at least one notification from this app.
          after_notification_share:
            first?.bundle && tl.notifications.has(first.bundle)
              ? round2(ratio(notified, visits.length))
              : null,
        },
      };
    })
    .filter((r) => r.row.activations >= RULES.minActivations && r.row.days >= RULES.minAppDays)
    .sort((a, b) => b.row.activations - a.row.activations);

  if (rows.length === 0) {
    return notEnough(
      MAC_MINIMUM,
      `no Mac app reached ${RULES.minActivations} activations on ${RULES.minAppDays} or more days`,
    );
  }

  // The apps that pull attention away come first in the answer, then the most used of the rest.
  const distracting = rows.filter((r) => DISTRACTING.has(r.row.app.category)).slice(0, 5);
  const rest = rows.filter((r) => !DISTRACTING.has(r.row.app.category)).slice(0, 5);
  const shown = [...distracting, ...rest].sort((a, b) => b.row.activations - a.row.activations);
  const data: MacAppCadence = { days_with_data: withData.size, apps: shown.map((r) => r.row) };

  const lead = distracting[0];
  let summary: string;
  if (lead) {
    const r = lead.row;
    const parts = [
      `On the Mac, ${r.app.name} comes to the front ${rate(r.activations_per_day)} times a day.`,
    ];
    if (r.minutes_of_mac_use_per_activation !== null && r.median_gap_active_minutes !== null) {
      parts.push(
        `That is once every ${duration(r.minutes_of_mac_use_per_activation)} of Mac use, with a median gap of ${duration(r.median_gap_active_minutes)}.`,
      );
    }
    parts.push(`${pct(r.checks_share)} of those visits last under 30 seconds.`);
    if (r.after_notification_share !== null) {
      parts.push(`${pct(r.after_notification_share)} follow a notification within 60 seconds.`);
    }
    summary = parts.join(" ");
  } else {
    summary = `No messaging, social, video, news, shopping or travel app reached ${count(RULES.minActivations, "activation")} on the Mac.`;
  }
  const evidence = (lead ?? shown[0])?.visits
    .slice(-RULES.evidenceCap)
    .reverse()
    .map((v) => v.eventId);
  return found(MAC_MINIMUM, summary, evidence ?? [], data);
}
