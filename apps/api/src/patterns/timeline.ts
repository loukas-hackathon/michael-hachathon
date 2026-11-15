import {
  type AppCategory,
  bundleIdForAppName,
  categoriseApp,
  categoriseVisit,
  type Event,
  isBrowser,
  normaliseHost,
  type PatternDevice,
  type PatternSubject,
} from "@michael/shared";
import { HOUR, SECOND } from "./time";
import { type Span, subtractSpans, sum, union } from "./util";

// From raw events to one clean timeline. This file owns every rule about which source wins when
// two of them describe the same minute, so the detectors never have to think about it:
//
//   1. Mac: one thing in front at a time. A non browser app beats a web visit, a web visit beats
//      the bare browser, an extension visit beats a history visit, and among history visits the
//      page opened last wins. History visits Chrome did not measure in front are not used.
//      Screen off time is removed.
//   2. Web visits: where the extension reported, history is ignored (`preferExtension`). Where
//      the Mac log is alive, a visit only refines browser time and never adds time of its own.
//   3. Across devices: when the phone and the Mac overlap, the phone has the attention.
//   4. App usage: Apple's own logs (macos_usage, iphone_usage from the Biome backfill) are the
//      record. ActivityWatch (Mac) and iPhone Shortcuts (live opens and closes) fill the hours the
//      record does not cover yet (`preferRecord`), so the same minute is never counted twice.

export type OpenedFrom = "home_screen" | "app_switcher" | "notification" | "other";
export type WebOrigin = "history" | "extension";

export interface Segment extends Span {
  device: PatternDevice;
  kind: "app" | "site";
  /** Bundle id for an app, host for a site. */
  key: string;
  name: string;
  category: AppCategory;
  /** Identity at app level: every site shares the browser's key, so moving between sites is not an app switch. */
  appKey: string;
  eventId: string;
  openedFrom: OpenedFrom | null;
}

/** An app interval, and whether it comes from a live backup source rather than Apple's own log. */
export interface AppUse extends Segment {
  backup: boolean;
}

export interface WebVisit extends Segment {
  origin: WebOrigin;
  /**
   * False when the length is how long the page stayed open, not how long it was in front (history
   * rows Chrome did not measure, `data.foreground = false`). Such a visit is not used.
   */
  measured: boolean;
}

export interface Timeline {
  from: number;
  to: number;
  /** The Mac alone: what was in front, no overlaps, screen off removed. */
  mac: Segment[];
  /** The iPhone alone. */
  iphone: Segment[];
  /** Both devices as one line of attention. Sorted, no overlaps. */
  attention: Segment[];
  /** Mac time that sits under phone use (counted once, as phone time). */
  overlapMs: number;
  /** Mac notifications by bundle id, times ascending. */
  notifications: Map<string, number[]>;
  searches: { at: number; id: string }[];
  counts: {
    macAppUsage: number;
    iphoneAppUsage: number;
    /** Live app intervals (ActivityWatch, Shortcuts) left out because Apple's log covers their hour. */
    appUsageSuperseded: number;
    webVisits: number;
    webVisitsSuperseded: number;
    webVisitsUnmeasured: number;
    searches: number;
  };
}

export const subjectOf = (s: Segment): PatternSubject => ({
  kind: s.kind,
  key: s.key,
  name: s.name,
  category: s.category,
});

const BROWSER_APP_KEY = "mac:browser";
/** The Mac log counts as alive this long before and after any Mac app interval. */
const MAC_ALIVE_MS = 6 * HOUR;
const OPENED_FROM = new Set<string>(["home_screen", "app_switcher", "notification", "other"]);

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Whole seconds, so that totals add up exactly. */
const at = (isoTime: string) => Math.round(Date.parse(isoTime) / SECOND) * SECOND;

// Where app usage comes from. Apple's logs are the record; the others are live backups.
const APP_SOURCES: Record<string, { device: PatternDevice; backup: boolean }> = {
  macos_usage: { device: "mac", backup: false },
  iphone_usage: { device: "iphone", backup: false },
  activitywatch: { device: "mac", backup: true },
  ios_shortcuts: { device: "iphone", backup: true },
};

/**
 * App usage from the Mac and the iPhone: Apple's own logs, ActivityWatch and iPhone Shortcuts.
 * An app is known by its bundle id, else by its name when the name says one well known app, else
 * by the name itself (key and name). Anything without an app or an end is skipped.
 */
export function parseAppUsage(events: Event[]): AppUse[] {
  const out: AppUse[] = [];
  for (const e of events) {
    if (e.type !== "app_usage" || !e.end_at) continue;
    const source = Object.hasOwn(APP_SOURCES, e.source) ? APP_SOURCES[e.source] : undefined;
    if (!source) continue;
    const named = str(e.data.app) ?? str(e.title);
    const bundle = str(e.data.bundle_id) ?? (source.backup && named ? bundleIdForAppName(named) : null);
    const key = bundle ?? (source.backup ? named : null);
    if (!key) continue;
    const start = at(e.start_at);
    const end = at(e.end_at);
    if (!(end > start)) continue;
    // The iPhone collector also reads the Apple Watch. A glance at the watch is not phone use.
    if (e.data.device === "watch") continue;
    const device = source.device;
    const opened = str(e.data.opened_from);
    out.push({
      start,
      end,
      device,
      kind: "app",
      key,
      name: e.title || named || key,
      category: bundle ? categoriseApp(bundle) : "other",
      appKey: device === "mac" && bundle && isBrowser(bundle) ? BROWSER_APP_KEY : `${device}:${key}`,
      eventId: e.id,
      openedFrom: opened && OPENED_FROM.has(opened) ? (opened as OpenedFrom) : null,
      backup: source.backup,
    });
  }
  return out;
}

/**
 * THE rule for two descriptions of the same app use. Apple's own log (the Mac's, and the iPhone's
 * Biome backfill, which lands up to a day late) is the record; ActivityWatch and Shortcuts are live
 * backups. Per device, for every clock hour (UTC) in which the record has at least one interval,
 * backup intervals that start in that hour are ignored. Until the backfill arrives the live
 * intervals stand in; once it does, they step aside.
 */
export function preferRecord(uses: AppUse[]): { kept: AppUse[]; superseded: number } {
  const covered = new Set<string>();
  for (const u of uses) {
    if (u.backup) continue;
    for (let h = Math.floor(u.start / HOUR); h * HOUR < u.end; h++) covered.add(`${u.device}:${h}`);
  }
  const kept = uses.filter((u) => !u.backup || !covered.has(`${u.device}:${Math.floor(u.start / HOUR)}`));
  return { kept, superseded: uses.length - kept.length };
}

/** Web visits from Chrome. The end is `end_at`, or the start plus `seconds` when there is none. */
export function parseWebVisits(events: Event[]): WebVisit[] {
  const out: WebVisit[] = [];
  for (const e of events) {
    if (e.type !== "web_visit") continue;
    const rawHost = str(e.data.host);
    if (!rawHost) continue;
    const host = normaliseHost(rawHost);
    if (!host) continue;
    const start = at(e.start_at);
    const seconds = num(e.data.seconds);
    const end = e.end_at ? at(e.end_at) : seconds !== null ? start + Math.round(seconds) * SECOND : start;
    if (!(end > start)) continue;
    out.push({
      start,
      end,
      device: "mac",
      kind: "site",
      key: host,
      name: host,
      // The shared host list first, then the label the collector sent, else "other".
      category: categoriseVisit(host, e.data.category),
      appKey: BROWSER_APP_KEY,
      eventId: e.id,
      openedFrom: null,
      origin: e.data.origin === "extension" ? "extension" : "history",
      measured: e.data.foreground !== false,
    });
  }
  return out;
}

/**
 * THE rule for two descriptions of the same browsing. The extension measures the active tab live;
 * the history file is the backfill. For every clock hour (UTC) in which the extension reported at
 * least one visit, history visits that start in that hour are ignored, so the time is not counted
 * twice. Any overlap left at the edge of an hour is settled when the Mac timeline is flattened,
 * where the extension also wins.
 */
export function preferExtension(visits: WebVisit[]): { kept: WebVisit[]; superseded: number } {
  const covered = new Set<number>();
  for (const v of visits) {
    if (v.origin !== "extension") continue;
    for (let h = Math.floor(v.start / HOUR); h * HOUR < v.end; h++) covered.add(h);
  }
  if (covered.size === 0) return { kept: visits, superseded: 0 };
  const kept = visits.filter((v) => v.origin === "extension" || !covered.has(Math.floor(v.start / HOUR)));
  return { kept, superseded: visits.length - kept.length };
}

/** Stretches with the Mac screen off. Zero length rows carry no span and are skipped. */
export function screenOffSpans(events: Event[]): Span[] {
  const spans: Span[] = [];
  for (const e of events) {
    if (e.type !== "screen" || e.source !== "macos_usage" || !e.end_at) continue;
    if (e.data.state !== "off") continue;
    spans.push({ start: at(e.start_at), end: at(e.end_at) });
  }
  return union(spans);
}

function cut<T extends Span>(items: T[], holes: Span[]): T[] {
  if (holes.length === 0) return items;
  const out: T[] = [];
  for (const item of items) {
    for (const piece of subtractSpans(item, holes)) out.push({ ...item, start: piece.start, end: piece.end });
  }
  return out;
}

/** The parts of `span` that lie inside `spans` (merged and sorted). */
function overlaps(span: Span, spans: Span[]): Span[] {
  // Merged spans are sorted by end as well as by start, so the first candidate can be searched.
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((spans[mid]?.end ?? Number.POSITIVE_INFINITY) <= span.start) lo = mid + 1;
    else hi = mid;
  }
  const out: Span[] = [];
  for (let i = lo; i < spans.length; i++) {
    const s = spans[i];
    if (!s || s.start >= span.end) break;
    out.push({ start: Math.max(s.start, span.start), end: Math.min(s.end, span.end) });
  }
  return out;
}

function clip<T extends Span>(items: T[], from: number, to: number): T[] {
  const out: T[] = [];
  for (const item of items) {
    const start = Math.max(item.start, from);
    const end = Math.min(item.end, to);
    if (end > start) out.push(start === item.start && end === item.end ? item : { ...item, start, end });
  }
  return out;
}

/**
 * One winner per instant. Higher `prio` wins; at equal priority the span that started later wins
 * (the app brought to the front last). The result is sorted and has no overlaps, and its total
 * length is the length of the union of the inputs: nothing is counted twice, nothing is lost.
 */
export function flatten<T extends Span>(items: { seg: T; prio: number }[]): T[] {
  const sorted = items.filter((i) => i.seg.end > i.seg.start).sort((a, b) => a.seg.start - b.seg.start);
  const out: T[] = [];
  let active: { seg: T; prio: number; order: number }[] = [];
  let next = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  let lastSource: T | null = null;

  while (next < sorted.length || active.length > 0) {
    if (active.length === 0) cursor = Math.max(cursor, sorted[next]?.seg.start ?? cursor);
    while (next < sorted.length) {
      const item = sorted[next];
      if (!item || item.seg.start > cursor) break;
      active.push({ ...item, order: next });
      next++;
    }
    active = active.filter((a) => a.seg.end > cursor);
    if (active.length === 0) continue;

    let winner = active[0];
    let stop = sorted[next]?.seg.start ?? Number.POSITIVE_INFINITY;
    for (const a of active) {
      stop = Math.min(stop, a.seg.end);
      if (!winner) winner = a;
      else if (a.prio > winner.prio) winner = a;
      else if (a.prio === winner.prio && a.order > winner.order) winner = a;
    }
    if (!winner) break;

    const last = out[out.length - 1];
    if (last && lastSource === winner.seg && last.end === cursor) last.end = stop;
    else out.push({ ...winner.seg, start: cursor, end: stop });
    lastSource = winner.seg;
    cursor = stop;
  }
  return out;
}

/** Everything the detectors need, built once. `from` and `to` are instants in ms. */
export function buildTimeline(events: Event[], from: number, to: number): Timeline {
  const parsed = clip(parseAppUsage(events), from, to);
  const { kept: usage, superseded: appUsageSuperseded } = preferRecord(parsed);
  const off = screenOffSpans(events);
  const macUsage = usage.filter((s) => s.device === "mac");
  const macApps = cut(macUsage, off);
  const phoneApps = usage.filter((s) => s.device === "iphone");

  const allVisits = clip(parseWebVisits(events), from, to);
  const { kept, superseded } = preferExtension(allVisits);
  // A history visit Chrome did not measure in front only says how long the page stayed open. An
  // open tab would claim every browser minute until the next page is opened, and a site would be
  // blamed for time it never had. Such visits are left out: that browser time stays "other".
  const believed = kept.filter((v) => v.measured);

  // The Mac's own log is the better witness of what was in front. Wherever it is alive (within
  // 6 hours of any Mac app interval), a web visit only refines time a browser was in front: it
  // never adds Mac time of its own. Where the Mac log has nothing (before its 4 week horizon, or
  // no Mac collector), a visit stands by itself.
  const browserInFront = union(macApps.filter((s) => s.appKey === BROWSER_APP_KEY));
  const macAlive = union(macUsage.map((s) => ({ start: s.start - MAC_ALIVE_MS, end: s.end + MAC_ALIVE_MS })));
  const visits = cut(believed, off).flatMap((v) => {
    const pieces: WebVisit[] = [];
    for (const alive of overlaps(v, macAlive)) {
      for (const p of overlaps(alive, browserInFront)) pieces.push({ ...v, start: p.start, end: p.end });
    }
    for (const p of subtractSpans(v, macAlive)) pieces.push({ ...v, start: p.start, end: p.end });
    return pieces;
  });
  // Among history visits the page opened last wins. History gives a page's total time in front
  // but not when a tab was switched back to, so the visit is placed right after it was opened:
  // with history alone the split of browser time between sites is an estimate. The extension
  // makes it exact.
  const mac = flatten<Segment>([
    ...macApps.map((seg) => ({ seg, prio: seg.appKey === BROWSER_APP_KEY ? 0 : seg.backup ? 2.5 : 3 })),
    ...visits.map((seg) => ({ seg: seg as Segment, prio: seg.origin === "extension" ? 2 : 1 })),
  ]);
  // At the edge of an hour a live backup can still overlap the record: the record wins.
  const iphone = flatten<Segment>(phoneApps.map((seg) => ({ seg, prio: seg.backup ? 0 : 1 })));
  const attention = flatten<Segment>([
    ...mac.map((seg) => ({ seg, prio: 0 })),
    ...iphone.map((seg) => ({ seg, prio: 1 })),
  ]);

  const macTotal = sum(mac.map((s) => s.end - s.start));
  const macInAttention = sum(attention.filter((s) => s.device === "mac").map((s) => s.end - s.start));

  const notifications = new Map<string, number[]>();
  const searches: { at: number; id: string }[] = [];
  for (const e of events) {
    if (e.type === "notification" && e.source === "macos_usage") {
      const bundle = str(e.data.bundle_id);
      if (!bundle) continue;
      const list = notifications.get(bundle);
      if (list) list.push(at(e.start_at));
      else notifications.set(bundle, [at(e.start_at)]);
    } else if (e.type === "search") {
      const t = at(e.start_at);
      if (t >= from && t < to) searches.push({ at: t, id: e.id });
    }
  }
  for (const list of notifications.values()) list.sort((a, b) => a - b);
  searches.sort((a, b) => a.at - b.at);

  return {
    from,
    to,
    mac,
    iphone,
    attention,
    overlapMs: macTotal - macInAttention,
    notifications,
    searches,
    counts: {
      macAppUsage: macUsage.length,
      iphoneAppUsage: phoneApps.length,
      appUsageSuperseded,
      webVisits: believed.length,
      webVisitsSuperseded: superseded,
      webVisitsUnmeasured: kept.length - believed.length,
      searches: searches.length,
    },
  };
}

/** True when the Mac showed a notification from this app in the `windowMs` before `t`. */
export function notifiedBefore(tl: Timeline, bundle: string, t: number, windowMs: number): boolean {
  const list = tl.notifications.get(bundle);
  if (!list) return false;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] ?? Number.POSITIVE_INFINITY) < t - windowMs) lo = mid + 1;
    else hi = mid;
  }
  const hit = list[lo];
  return hit !== undefined && hit <= t;
}
