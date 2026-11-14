import type { Event, LocationSignal, Place, VisitData } from "@michael/shared";

// Where the user was, as place visits. Pure: the route (routes/location.ts) reads the store and
// the clock, this module only decides.
//
// A signal is a phone position or the Mac's Wi-Fi network. It becomes, or extends, one visit:
//   - a point within RADIUS_M of a saved place, or a network mapped to one, is that place;
//   - a network nobody mapped yet joins the visit going on (that is how "This is Home's Wi-Fi"
//     gets suggested), unless that visit already has a different network: then it is "Out";
//   - a point near no saved place is "Out" (or the location of the calendar event at that time),
//     rounded to about a kilometre. No raw trail is ever kept.
// The same place again within the gap extends the visit; anything else starts a new one.
//
// Calendar events whose location names a saved place count as planned visits, but only where no
// signal says where the user was (plannedVisits).

export const RADIUS_M = 150;
/** The collector reports every minute or so: a longer silence means the Mac left or slept. */
export const WIFI_GAP_MS = 20 * 60_000;
/** The phone reports only when Michael is opened. */
export const POINT_GAP_MS = 3 * 3600_000;
/** Away from saved places, points further apart than this are different places. */
const OUT_SAME_M = 1000;
/** A visit is "now" while its last signal is this recent. */
export const NOW_MS = 30 * 60_000;

export const VISIT_SOURCE = "location" as const;

/** One visit, the shape of the event that stores it. */
export interface Visit {
  start: number;
  end: number;
  label: string;
  data: VisitData;
}

export interface Classified {
  at: number;
  kind: LocationSignal["kind"];
  /** A saved place, or null. */
  place: Place | null;
  /** Unmapped network id (wifi only). */
  unmapped: string | null;
  network: string | null;
  /** The network's name, when the Mac could read it. */
  name: string | null;
  /** Rounded position for points away from saved places. */
  coarse: { lat: number; lng: number } | null;
}

const located = (p: Place): p is Place & { lat: number; lng: number } => p.lat !== null && p.lng !== null;

/** Great circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** About a kilometre: enough for "in Kifisia", never a street. */
export const coarse = (n: number) => Math.round(n * 100) / 100;

/** The saved place a point is at: the nearest within RADIUS_M (plus the fix's own accuracy, up to 100 m). */
export function placeAt(p: { lat: number; lng: number; accuracy_m?: number | null }, places: Place[]) {
  const reach = RADIUS_M + Math.min(100, Math.max(0, p.accuracy_m ?? 0));
  let best: Place | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const place of places) {
    if (!located(place)) continue;
    const d = distanceM(p, place);
    if (d <= reach && d < bestD) {
      best = place;
      bestD = d;
    }
  }
  return best;
}

export function classify(signal: LocationSignal, places: Place[]): Classified {
  const at = Date.parse(signal.at);
  if (signal.kind === "wifi") {
    const place = places.find((p) => p.wifi?.includes(signal.network)) ?? null;
    return {
      at,
      kind: "wifi",
      place,
      unmapped: place ? null : signal.network,
      network: signal.network,
      name: signal.name ?? null,
      coarse: null,
    };
  }
  const place = placeAt(signal, places);
  return {
    at,
    kind: "point",
    place,
    unmapped: null,
    network: null,
    name: null,
    coarse: place ? null : { lat: coarse(signal.lat), lng: coarse(signal.lng) },
  };
}

const evidenceOf = (kind: LocationSignal["kind"]) => (kind === "wifi" ? "wifi" : "phone");
const gapFor = (kind: LocationSignal["kind"]) => (kind === "wifi" ? WIFI_GAP_MS : POINT_GAP_MS);

function withSignal(v: Visit, s: Classified): Visit {
  const evidence = evidenceOf(s.kind);
  return {
    ...v,
    start: Math.min(v.start, s.at),
    end: Math.max(v.end, s.at),
    data: {
      ...v.data,
      evidence: v.data.evidence.includes(evidence) ? v.data.evidence : [...v.data.evidence, evidence],
      networks: s.network && !v.data.networks.includes(s.network) ? [...v.data.networks, s.network] : v.data.networks,
      ...(s.network && s.name ? { names: { ...v.data.names, [s.network]: s.name } } : {}),
    },
  };
}

function fresh(s: Classified, outLabel: string): Visit {
  return {
    start: s.at,
    end: s.at,
    label: s.place?.label ?? outLabel,
    data: {
      place_key: s.place?.key ?? null,
      evidence: [evidenceOf(s.kind)],
      networks: s.network ? [s.network] : [],
      ...(s.network && s.name ? { names: { [s.network]: s.name } } : {}),
      ...(s.coarse ? { lat: s.coarse.lat, lng: s.coarse.lng } : {}),
    },
  };
}

/** True when the signal continues `open` rather than starting a new visit. */
function continues(open: Visit, s: Classified): boolean {
  if (s.at - open.end > gapFor(s.kind) || s.at < open.start) return false;
  if (s.place) return open.data.place_key === s.place.key;
  if (s.unmapped) {
    // A network no one mapped belongs to the visit going on, unless that visit is on another one.
    const nets = open.data.networks;
    return nets.length === 0 || nets.includes(s.unmapped);
  }
  // A point away from saved places.
  if (open.data.place_key !== null) return false;
  if (open.data.lat == null || open.data.lng == null || !s.coarse) return open.data.networks.length > 0;
  return distanceM({ lat: open.data.lat, lng: open.data.lng }, s.coarse) <= OUT_SAME_M;
}

/**
 * Applies signals (any order) to the visit going on. Returns every visit touched: the open one
 * first if it changed, then new ones, in time order. `outLabel(at)` names a moment away from
 * saved places (the calendar event's location, or "Out").
 */
export function applySignals(
  open: Visit | null,
  signals: Classified[],
  outLabel: (at: number) => string = () => "Out",
): Visit[] {
  const out: Visit[] = [];
  let current = open;
  let dirty = false;
  for (const s of [...signals].sort((a, b) => a.at - b.at)) {
    if (!Number.isFinite(s.at)) continue;
    if (current && continues(current, s)) {
      current = withSignal(current, s);
      dirty = true;
      continue;
    }
    if (current && dirty) out.push(current);
    current = fresh(s, outLabel(s.at));
    dirty = true;
  }
  if (current && dirty) out.push(current);
  return out;
}

// ---------- events <-> visits ----------

export const visitExternalId = (v: Visit) =>
  `visit:${v.data.place_key ?? "out"}:${new Date(v.start).toISOString().slice(0, 19)}`;

export function visitEvent(v: Visit) {
  return {
    source: VISIT_SOURCE,
    type: "location" as const,
    start_at: new Date(v.start).toISOString(),
    end_at: new Date(v.end).toISOString(),
    title: v.label,
    data: { ...v.data },
    external_id: visitExternalId(v),
  };
}

/** A stored visit event back as a Visit; null for location events that are not visits. */
export function visitFromEvent(e: Event): Visit | null {
  if (e.type !== "location" || e.source !== VISIT_SOURCE) return null;
  const d = e.data as Partial<VisitData>;
  const start = Date.parse(e.start_at);
  return {
    start,
    end: e.end_at ? Date.parse(e.end_at) : start,
    label: e.title,
    data: {
      place_key: typeof d.place_key === "string" ? d.place_key : null,
      evidence: Array.isArray(d.evidence) ? d.evidence.filter((x) => x === "wifi" || x === "phone") : [],
      networks: Array.isArray(d.networks) ? d.networks.filter((x): x is string => typeof x === "string") : [],
      ...(d.names && typeof d.names === "object" ? { names: d.names as Record<string, string> } : {}),
      ...(typeof d.lat === "number" && typeof d.lng === "number" ? { lat: d.lat, lng: d.lng } : {}),
    },
  };
}

// ---------- the calendar's plan ----------

export interface PlannedVisit {
  start: number;
  end: number;
  label: string;
  place_key: string;
  /** The calendar event's title. */
  title: string;
}

const VIRTUAL = /meet\.google|zoom\.us|teams\.microsoft|^https?:|google meet|zoom|teams/i;

/** The saved place a calendar location names, by label, key, or address. */
export function placeNamed(location: string, places: Place[]): Place | null {
  const text = location.trim().toLowerCase();
  if (!text || VIRTUAL.test(text)) return null;
  const exact = places.find(
    (p) => p.label.toLowerCase() === text || p.key === text || p.address?.toLowerCase() === text,
  );
  if (exact) return exact;
  return (
    places.find((p) => {
      const word = p.key.replace(/_/g, " ");
      return new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, "u").test(text);
    }) ?? null
  );
}

/** The calendar location at `at`, if an event with a real location covers it. */
export function calendarLocationAt(at: number, calendar: Event[]): string | null {
  for (const e of calendar) {
    if (e.type !== "calendar_event" || !e.end_at) continue;
    const loc = typeof e.data.location === "string" ? e.data.location.trim() : "";
    if (!loc || VIRTUAL.test(loc)) continue;
    if (Date.parse(e.start_at) <= at && at < Date.parse(e.end_at)) return loc.split(",")[0]?.trim() || null;
  }
  return null;
}

/**
 * Calendar events at a saved place, where no visit says where the user was. Marked planned, never
 * confirmed: they are what the user meant to do.
 */
export function plannedVisits(calendar: Event[], places: Place[], visits: Visit[]): PlannedVisit[] {
  const out: PlannedVisit[] = [];
  for (const e of calendar) {
    if (e.type !== "calendar_event" || !e.end_at) continue;
    const loc = typeof e.data.location === "string" ? e.data.location : "";
    const place = loc ? placeNamed(loc, places) : null;
    if (!place) continue;
    const start = Date.parse(e.start_at);
    const end = Date.parse(e.end_at);
    if (!(end > start)) continue;
    if (visits.some((v) => v.start < end && Math.max(v.end, v.start + 60_000) > start)) continue;
    out.push({ start, end, label: place.label, place_key: place.key, title: e.title });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- what a place means for goals ----------

const TRAINING = /\b(gym|pool|crossfit|track|yoga|pilates|climb\w*|dojo|fitness)\b/i;
const BUSINESS = /\b(work|office|university|uni|campus|school|library|cowork\w*|studio)\b/i;

/** "training" for a gym, "business" for work or university, else null. */
export function placeRole(place: { key: string; label: string }): "training" | "business" | null {
  const text = `${place.key.replace(/_/g, " ")} ${place.label}`;
  if (TRAINING.test(text)) return "training";
  if (BUSINESS.test(text)) return "business";
  return null;
}

/** Spans of confirmed time at training and business places, for the score. */
export function placeProof(events: Event[], places: Place[]) {
  const byKey = new Map(places.map((p) => [p.key, p]));
  const training: { start: number; end: number }[] = [];
  const business: { start: number; end: number }[] = [];
  for (const e of events) {
    const v = visitFromEvent(e);
    if (!v?.data.place_key || !(v.end > v.start)) continue;
    const place = byKey.get(v.data.place_key) ?? { key: v.data.place_key, label: v.label };
    const role = placeRole(place);
    if (role === "training") training.push({ start: v.start, end: v.end });
    if (role === "business") business.push({ start: v.start, end: v.end });
  }
  return { training, business };
}
