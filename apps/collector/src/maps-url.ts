import type { MapsQuery, MapsStop } from "@michael/shared";

// Google Maps addresses carry what was searched for, which place was opened, or the two ends of
// directions, and usually the map position too (`/@38.74,22.35,14z`, `data=!3d..!4d..`). Chrome
// files the whole tail of the path as the search term, so without this the timeline would show
// coordinates as a search. This module turns a Maps address into a clean term plus a structured
// `MapsQuery`. Coordinates only ever go into the structured fields, never into the term; the API
// drops them unless the user has switched source maps on.
//
// Pure: no I/O, so it is tested over a set of real address shapes in maps-url.test.ts.

const MAX_TEXT = 200;

export type MapsSearch = { term: string; maps: MapsQuery };

/** True for google.<tld>/maps... and maps.google.<tld>. Short links (maps.app.goo.gl) are not. */
export function isMapsUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (/^maps\.google\.[a-z.]+$/.test(host)) return true;
  return /^google\.[a-z.]+$/.test(host) && /^\/maps(\/|$)/.test(parsed.pathname);
}

/**
 * The search a Maps address stands for, or null when it is not one: a bare map view, a short link
 * (maps.app.goo.gl, goo.gl/maps), a place id with no name, or anything that is not Maps at all.
 */
export function parseMapsUrl(url: string): MapsSearch | null {
  if (!isMapsUrl(url)) return null;
  const parsed = parseUrl(url);
  if (!parsed) return null;

  // Everything after /maps, split on "/", with the map position and data blob set aside. Raw
  // segments are decoded one at a time so an encoded "/" inside a name stays part of it.
  const raw = parsed.pathname
    .replace(/^\/maps/, "")
    .split("/")
    .slice(1);
  const segments: string[] = [];
  let viewport: { lat: number; lng: number } | null = null;
  let blob = "";
  for (const segment of raw) {
    if (segment.startsWith("@")) {
      viewport = coordinates(segment.slice(1));
      continue;
    }
    if (segment.startsWith("data=")) {
      blob = segment;
      continue;
    }
    segments.push(decode(segment));
  }
  const params = parsed.searchParams;
  const [mode, ...rest] = segments;

  if (mode === "dir") {
    // /maps/dir/A/B/ (waypoints in between are ignored) or /maps/dir/?api=1&origin=A&destination=B.
    const stops = rest.filter((s) => s.trim() !== "");
    const fromText =
      param(params, "origin") ?? param(params, "saddr") ?? (stops.length > 1 ? (stops[0] ?? null) : null);
    const toText = param(params, "destination") ?? param(params, "daddr") ?? stops.at(-1) ?? null;
    return directions(fromText, toText);
  }

  if (mode === "place") {
    const nameText = rest[0] || (param(params, "q") ?? param(params, "query"));
    // Exact place coordinates live in the data blob (!3d lat !4d lng); the @ position is where the
    // map was centred, which for a place page is the place itself.
    const exact = blobCoordinates(blob);
    return place(nameText ?? null, exact ?? viewport);
  }

  if (mode === "search") {
    const queryText = rest[0] || (param(params, "query") ?? param(params, "q"));
    return search(queryText ?? null);
  }

  // Older and shared forms: /maps?q=..., /maps?saddr=..&daddr=.., maps.google.com/?q=...
  const daddr = param(params, "daddr") ?? param(params, "destination");
  if (daddr) return directions(param(params, "saddr") ?? param(params, "origin"), daddr);
  const q = param(params, "q") ?? param(params, "query");
  if (q) return search(q);
  return null;
}

// ---------- the three kinds ----------

function search(text: string | null): MapsSearch | null {
  const stop = toStop(text);
  if (!stop) return null;
  // A search for a bare position ("38.0,23.7") is a dropped pin, not a search for words.
  if (stop.name === null)
    return { term: "Dropped pin", maps: { kind: "place", place: stop, from: null, to: null } };
  return {
    term: stop.name,
    maps: { kind: "search", place: { ...stop, lat: null, lng: null }, from: null, to: null },
  };
}

function place(text: string | null, at: { lat: number; lng: number } | null): MapsSearch | null {
  const stop = toStop(text);
  const name = stop?.name ?? null;
  const lat = stop?.lat ?? at?.lat ?? null;
  const lng = stop?.lng ?? at?.lng ?? null;
  if (name === null && lat === null) return null;
  return {
    term: name ?? "Dropped pin",
    maps: { kind: "place", place: { name, lat, lng }, from: null, to: null },
  };
}

function directions(fromText: string | null, toText: string | null): MapsSearch | null {
  const from = toStop(fromText);
  const to = toStop(toText);
  if (!to && !from) return null;
  const term =
    from?.name && to?.name
      ? `${from.name} to ${to.name}`
      : to?.name
        ? `Directions to ${to.name}`
        : from?.name
          ? `Directions from ${from.name}`
          : "Directions";
  return { term: term.slice(0, MAX_TEXT), maps: { kind: "directions", place: null, from, to } };
}

// ---------- helpers ----------

/** A name, or coordinates when the text is only a position. Never both from one text. */
function toStop(text: string | null | undefined): MapsStop | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const at = coordinates(clean);
  if (at) return { name: null, ...at };
  // Degrees, minutes and seconds (38°00'00.0"N 23°44'00.0"E) are a position written out.
  if (/^\d{1,3}°/.test(clean)) return { name: null, lat: null, lng: null };
  // "place_id:ChIJ..." and "Current Location" style placeholders say nothing a person typed.
  if (/^place_id:/i.test(clean)) return null;
  return { name: clean.slice(0, MAX_TEXT), lat: null, lng: null };
}

/** "38.0,23.7" or "38.0, 23.7,14z" (the zoom is ignored). Out of range numbers are not a position. */
function coordinates(text: string): { lat: number; lng: number } | null {
  const match = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)(?:\s*,.*)?$/.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** The place's own position from a data blob: the last !3d<lat>!4d<lng> pair. */
function blobCoordinates(blob: string): { lat: number; lng: number } | null {
  const pairs = [...blob.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  const last = pairs.at(-1);
  if (!last) return null;
  return coordinates(`${last[1]},${last[2]}`);
}

function param(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value?.trim() ? value : null;
}

/** Path segments use "+" for spaces as well as %20. A broken escape is kept as written. */
function decode(segment: string): string {
  // Each run of escapes is decoded on its own, so one stray "%" does not spoil the rest.
  return segment.replace(/\+/g, " ").replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/** Page titles such as `38°00'00.0"N 23°44'00.0"E - Google Maps` or `38.0, 23.7` are positions. */
export function titleHasPosition(title: string): boolean {
  return /\d{1,3}°\s*\d/.test(title) || /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(title);
}
