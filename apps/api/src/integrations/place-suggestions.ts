import { type Event, MapsQuery, type Place, type PlaceKey, type PlaceSuggestion } from "@michael/shared";

// Places the user keeps looking up in Google Maps (chrome search events with `data.maps`), offered
// as saved places so travel times work without typing addresses. Pure: the route reads the events
// and the privacy switch, this only counts. Nothing here ever saves a place.

const MIN_COUNT = 2;
const MAX_SUGGESTIONS = 5;
// A saved place this close to a suggestion is the same place.
const SAME_PLACE_METRES = 200;

// What the name says the place is. Checked in this order; the first match wins.
const KEY_HINTS: [PlaceKey, RegExp][] = [
  ["gym", /\b(gym|fitness|crossfit|pilates|yoga)\b|γυμναστ/i],
  ["university", /universit|college|campus|πανεπιστ|πολυτεχν/i],
  ["work", /\b(office|offices|work|cowork\w*|hq)\b|γραφεί/i],
  ["home", /^home$|^σπίτι$/i],
];

// Searches for a kind of place ("coffee near me") are not one place.
const GENERIC = /\bnear( me)?\b|\bnearby\b|\bopen now\b|κοντά/i;

type Tally = {
  label: string;
  lat: number | null;
  lng: number | null;
  count: number;
  last: string;
  asOrigin: number;
};

const normalise = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Frequent Maps places that are not saved yet, most looked up first. */
export function suggestPlaces(events: Event[], saved: Place[]): PlaceSuggestion[] {
  const tally = new Map<string, Tally>();
  const add = (
    stop: { name: string | null; lat: number | null; lng: number | null } | null,
    at: string,
    origin = false,
  ) => {
    if (!stop?.name || GENERIC.test(stop.name)) return;
    const key = normalise(stop.name);
    const t = tally.get(key) ?? { label: stop.name, lat: null, lng: null, count: 0, last: at, asOrigin: 0 };
    t.count++;
    if (origin) t.asOrigin++;
    if (at >= t.last) {
      t.last = at;
      t.label = stop.name;
    }
    if (stop.lat !== null && stop.lng !== null) {
      t.lat = stop.lat;
      t.lng = stop.lng;
    }
    tally.set(key, t);
  };

  // Events come in time order, so the latest coordinates win.
  const ordered = [...events].sort((a, b) => a.start_at.localeCompare(b.start_at));
  for (const e of ordered) {
    const parsed = MapsQuery.safeParse((e.data as { maps?: unknown }).maps);
    if (!parsed.success) continue;
    const q = parsed.data;
    if (q.kind === "directions") {
      add(q.from, e.start_at, true);
      add(q.to, e.start_at);
    } else {
      add(q.place, e.start_at);
    }
  }

  const savedNames = new Set(saved.flatMap((p) => [p.label, p.address ?? ""].filter(Boolean).map(normalise)));
  const isSaved = (t: Tally) => {
    if (savedNames.has(normalise(t.label))) return true;
    const { lat, lng } = t;
    if (lat === null || lng === null) return false;
    return saved.some(
      (p) =>
        p.lat !== null &&
        p.lng !== null &&
        metres({ lat: p.lat, lng: p.lng }, { lat, lng }) <= SAME_PLACE_METRES,
    );
  };

  const ranked = [...tally.values()]
    .filter((t) => t.count >= MIN_COUNT && !isSaved(t))
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, MAX_SUGGESTIONS);

  // Each key is offered once, to the most looked up match, and never one the user already has.
  const taken = new Set<string>(saved.map((p) => p.key));
  const keys = ranked.map((t) => {
    const hint = KEY_HINTS.find(([key, pattern]) => !taken.has(key) && pattern.test(t.label))?.[0] ?? null;
    if (hint) taken.add(hint);
    return hint;
  });
  // Where directions most often start from is likely home, when nothing else claimed it.
  if (!taken.has("home")) {
    let best = -1;
    let bestCount = 0;
    ranked.forEach((t, i) => {
      if (keys[i] === null && t.asOrigin >= MIN_COUNT && t.asOrigin > bestCount) {
        best = i;
        bestCount = t.asOrigin;
      }
    });
    if (best >= 0) keys[best] = "home";
  }

  return ranked.map((t, i) => ({
    key: keys[i] ?? null,
    label: t.label.slice(0, 80),
    lat: t.lat,
    lng: t.lng,
    count: t.count,
    last_seen_at: t.last,
  }));
}
