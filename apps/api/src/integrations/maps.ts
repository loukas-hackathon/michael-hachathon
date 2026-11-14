import { z } from "zod";
import { env } from "../env";
import { HttpError } from "../http";
import type { Store } from "../store";

// Google Maps Platform behind one server side key (GOOGLE_MAPS_API_KEY). The user never sees a key.
//
//   Geocoding API      address -> lat/lng      SKU "Geocoding" (Essentials, 10,000 free a month)
//   Routes API         computeRoutes, DRIVE, routingPreference TRAFFIC_AWARE, departureTime
//                      SKU "Compute Routes Pro" (traffic aware), 5,000 free a month
//
// Without a key `mapsAvailable()` is false and callers skip travel altogether.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeHit extends LatLng {
  formatted_address: string;
  place_id: string | null;
  fetched_at: string;
}

export interface RouteEstimate {
  depart_at: string;
  // With traffic predicted for depart_at.
  seconds: number;
  // Empty roads.
  static_seconds: number;
  distance_meters: number;
}

export interface MapsDeps {
  apiKey?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
// Only what we read: a smaller field mask is faster, and the SKU depends on the request, not the mask.
const ROUTES_FIELD_MASK = "routes.duration,routes.staticDuration,routes.distanceMeters";
// Google's terms allow caching geocoded coordinates for up to 30 days.
const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const mapsAvailable = (deps: MapsDeps = {}) => Boolean(deps.apiKey ?? env.GOOGLE_MAPS_API_KEY);

const keyOf = (deps: MapsDeps) => {
  const key = deps.apiKey ?? env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new HttpError("not_implemented", "Travel times need GOOGLE_MAPS_API_KEY on the server");
  return key;
};

const GeocodeResponse = z.object({
  status: z.string(),
  error_message: z.string().optional(),
  results: z
    .array(
      z.object({
        formatted_address: z.string(),
        place_id: z.string().optional(),
        geometry: z.object({ location: z.object({ lat: z.number(), lng: z.number() }) }),
      }),
    )
    .default([]),
});

/** Normalised cache key for a free text place. */
export const placeQuery = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Geocode a free text place (a calendar location or a saved address). Cached per user in the
 * store for 30 days; a miss (ZERO_RESULTS) returns null and is not cached.
 */
export async function geocode(store: Store, text: string, deps: MapsDeps = {}): Promise<GeocodeHit | null> {
  const query = placeQuery(text);
  if (!query) return null;
  const now = (deps.now ?? Date.now)();
  const cached = await store.cachedGeocode(query);
  if (cached && now - Date.parse(cached.fetched_at) < GEOCODE_TTL_MS) return cached;

  const url = `${GEOCODE_URL}?${new URLSearchParams({ address: text, key: keyOf(deps) })}`;
  const res = await (deps.fetch ?? fetch)(url);
  if (!res.ok) throw new HttpError("upstream_error", `Google Geocoding failed (${res.status})`);
  const body = GeocodeResponse.safeParse(await res.json());
  if (!body.success) throw new HttpError("upstream_error", "Google Geocoding sent an unexpected response");
  if (body.data.status === "ZERO_RESULTS") return null;
  const first = body.data.results[0];
  if (body.data.status !== "OK" || !first) {
    throw new HttpError(
      "upstream_error",
      `Google Geocoding: ${body.data.status} ${body.data.error_message ?? ""}`.trim(),
    );
  }
  const hit: GeocodeHit = {
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
    formatted_address: first.formatted_address,
    place_id: first.place_id ?? null,
    fetched_at: new Date(now).toISOString(),
  };
  await store.saveGeocode(query, hit);
  return hit;
}

const RoutesResponse = z.object({
  routes: z
    .array(
      z.object({
        // Durations come as "1234s".
        duration: z.string().optional(),
        staticDuration: z.string().optional(),
        distanceMeters: z.number().optional(),
      }),
    )
    .default([]),
});

const seconds = (d: string | undefined) => {
  const n = d ? Number.parseFloat(d.replace(/s$/, "")) : Number.NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};

const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

/**
 * One driving route at one departure time, with traffic predicted for that time. Returns null
 * when Google finds no route. Departures in the past are moved to now (the Routes API rejects a
 * past departureTime for DRIVE).
 */
export async function routeAt(
  origin: LatLng,
  destination: LatLng,
  departAt: number,
  deps: MapsDeps = {},
): Promise<RouteEstimate | null> {
  const now = (deps.now ?? Date.now)();
  const depart = Math.max(departAt, now + 60_000);
  const res = await (deps.fetch ?? fetch)(ROUTES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": keyOf(deps),
      "X-Goog-FieldMask": ROUTES_FIELD_MASK,
    },
    body: JSON.stringify({
      origin: waypoint(origin),
      destination: waypoint(destination),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: new Date(depart).toISOString(),
      computeAlternativeRoutes: false,
      units: "METRIC",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(
      "upstream_error",
      `Google Routes failed (${res.status}) ${text.slice(0, 200)}`.trim(),
    );
  }
  const body = RoutesResponse.safeParse(await res.json());
  if (!body.success) throw new HttpError("upstream_error", "Google Routes sent an unexpected response");
  const route = body.data.routes[0];
  const s = seconds(route?.duration);
  if (!route || s === null) return null;
  return {
    depart_at: new Date(depart).toISOString(),
    seconds: s,
    static_seconds: seconds(route.staticDuration) ?? s,
    distance_meters: route.distanceMeters ?? 0,
  };
}

/** Travel time between two places at several departure times (one Routes call each, in parallel). */
export async function travelTimes(
  origin: LatLng,
  destination: LatLng,
  departures: number[],
  deps: MapsDeps = {},
): Promise<RouteEstimate[]> {
  const unique = [...new Set(departures)].sort((a, b) => a - b);
  const all = await Promise.all(unique.map((d) => routeAt(origin, destination, d, deps)));
  return all.filter((r): r is RouteEstimate => r !== null);
}

/** Straight line distance in metres. */
export function metresBetween(a: LatLng, b: LatLng): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
