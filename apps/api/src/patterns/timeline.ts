import {
  type AppCategory,
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
//      the bare browser, an extension visit beats a history visit, and a history visit Chrome
//      measured in front beats one that was only open. Screen off time is removed.
//   2. Web visits: where the extension reported, history is ignored (`preferExtension`).
//   3. Across devices: when the phone and the Mac overlap, the phone has the attention.

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

export interface WebVisit extends Segment {
  origin: WebOrigin;
  /**
   * False when the length is how long the page stayed open, not how long it was in front (history
   * rows Chrome did not measure, `data.foreground = false`). Such a visit only counts while a
   * browser is in front on the Mac.
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
    webVisits: number;
    webVisitsSuperseded: number;
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
const OPENED_FROM = new Set<string>(["home_screen", "app_switcher", "notification", "other"]);

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Whole seconds, so that totals add up exactly. */
const at = (isoTime: string) => Math.round(Date.parse(isoTime) / SECOND) * SECOND;

/** App usage from the Mac and the iPhone collectors. Anything without a bundle id or an end is skipped. */
export function parseAppUsage(events: Event[]): Segment[] {
  const out: Segment[] = [];
  for (const e of events) {
    if (e.type !== "app_usage" || !e.end_at) continue;
    if (e.source !== "macos_usage" && e.source !== "iphone_usage") continue;
    const bundle = str(e.data.bundle_id);
    if (!bundle) continue;
    const start = at(e.start_at);
    const end = at(e.end_at);
    if (!(end > start)) continue;
    // The iPhone collector also reads the Apple Watch. A glance at the watch is not phone use.
    if (e.data.device === "watch") continue;
    const device: PatternDevice = e.source === "iphone_usage" ? "iphone" : "mac";
    const opened = str(e.data.opened_from);
    out.push({
      start,
      end,
      device,
      kind: "app",
      key: bundle,
      name: e.title,
      category: categoriseApp(bundle),
      appKey: device === "mac" && isBrowser(bundle) ? BROWSER_APP_KEY : `${device}:${bundle}`,
      eventId: e.id,
      openedFrom: opened && OPENED_FROM.has(opened) ? (opened as OpenedFrom) : null,
    });
  }
  return out;
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
  const usage = clip(parseAppUsage(events), from, to);
  const off = screenOffSpans(events);
  const macUsage = usage.filter((s) => s.device === "mac");
  const macApps = cut(macUsage, off);
  const phoneApps = usage.filter((s) => s.device === "iphone");

  const allVisits = clip(parseWebVisits(events), from, to);
  const { kept, superseded } = preferExtension(allVisits);
  // A page that was only "open" may have sat in a background tab for an hour. It is believed
  // only while a browser is in front, and loses to any visit whose time in front was measured.
  const browserInFront = union(macApps.filter((s) => s.appKey === BROWSER_APP_KEY));
  const visits = cut(kept, off).flatMap((v) => {
    if (v.measured) return [v];
    const pieces: WebVisit[] = [];
    for (const b of browserInFront) {
      const start = Math.max(v.start, b.start);
      const end = Math.min(v.end, b.end);
      if (end > start) pieces.push({ ...v, start, end });
    }
    return pieces;
  });
  const visitPrio = (v: WebVisit) => (v.origin === "extension" ? 3 : v.measured ? 2 : 1);

  const mac = flatten<Segment>([
    ...macApps.map((seg) => ({ seg, prio: seg.appKey === BROWSER_APP_KEY ? 0 : 4 })),
    ...visits.map((seg) => ({ seg: seg as Segment, prio: visitPrio(seg) })),
  ]);
  const iphone = flatten<Segment>(phoneApps.map((seg) => ({ seg, prio: 0 })));
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
      webVisits: kept.length,
      webVisitsSuperseded: superseded,
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
