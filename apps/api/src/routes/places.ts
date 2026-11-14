import {
  type AddressSearchResponse,
  type Place,
  type PlaceSuggestionsResponse,
  type PlacesResponse,
  PlacesUpdate,
  TravelPlanInput,
  type TravelPlanResult,
} from "@michael/shared";
import { Hono } from "hono";
import { z } from "zod";
import { jsonBody, parse } from "../http";
import { geocode, mapsAvailable, searchAddress } from "../integrations/maps";
import { suggestPlaces } from "../integrations/place-suggestions";
import { planTravel, planWholeDay } from "../integrations/travel";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { Zone } from "../patterns/time";
import { store } from "../store";

// Saved places and travel times (docs/api.md, Places and travel).

// How far back Maps searches count towards a suggestion.
const SUGGESTION_DAYS = 30;

const DEFAULT_LABEL: Record<string, string> = {
  home: "Home",
  work: "Work",
  gym: "Gym",
  university: "University",
};

async function placesResponse(places?: Place[]): Promise<PlacesResponse> {
  const rules = await store.privacyRules();
  return {
    places: places ?? (await store.listPlaces()),
    maps_available: mapsAvailable(),
    travel_enabled: rules.sources.maps?.enabled === true,
  };
}

export const places = new Hono()
  .get("/places", async (c) => c.json(await placesResponse()))
  // Places the user often looks up in Google Maps, offered for saving. Only with source maps on;
  // never saved here.
  .get("/places/suggestions", async (c) => {
    const rules = await store.privacyRules();
    if (rules.sources.maps?.enabled !== true) {
      return c.json({ enabled: false, suggestions: [] } satisfies PlaceSuggestionsResponse);
    }
    const to = new Date();
    const from = new Date(to.getTime() - SUGGESTION_DAYS * 86_400_000);
    const [events, saved] = await Promise.all([
      store.listEvents({
        from: from.toISOString(),
        to: to.toISOString(),
        source: ["chrome"],
        type: ["search"],
      }),
      store.listPlaces(),
    ]);
    return c.json({
      enabled: true,
      suggestions: suggestPlaces(events, saved),
    } satisfies PlaceSuggestionsResponse);
  })
  // Address search for the Places screen. Without a maps key: no results, and it says so.
  .get("/places/search", async (c) => {
    const q = parse(z.string().max(200), c.req.query("q") ?? "");
    const body: AddressSearchResponse = mapsAvailable()
      ? { results: await searchAddress(q), maps_available: true }
      : { results: [], maps_available: false };
    return c.json(body);
  })
  .put("/places", async (c) => {
    const body = parse(PlacesUpdate, await jsonBody(c));
    const existing = new Map((await store.listPlaces()).map((p) => [p.key, p]));
    const rows: Omit<Place, "updated_at">[] = [];
    for (const p of body.places) {
      const address = p.address ?? null;
      let lat = p.lat ?? null;
      let lng = p.lng ?? null;
      const before = existing.get(p.key);
      if ((lat === null || lng === null) && address) {
        if (before && before.address === address && before.lat !== null) {
          ({ lat, lng } = before);
        } else if (mapsAvailable()) {
          const hit = await geocode(store, address);
          lat = hit?.lat ?? null;
          lng = hit?.lng ?? null;
        }
      }
      // Wi-Fi mappings are set on the Location page (routes/location.ts) and kept across edits.
      rows.push({
        key: p.key,
        label: p.label ?? DEFAULT_LABEL[p.key] ?? p.key,
        address,
        lat,
        lng,
        wifi: before?.wifi ?? [],
      });
    }
    const saved = await store.replacePlaces(rows);
    // Saving a place is the user's own opt in to travel times; the privacy switch turns it off.
    const rules = await store.privacyRules();
    if (saved.length && rules.sources.maps === undefined) await store.setSourceEnabled("maps", true);
    return c.json(await placesResponse(saved));
  })
  // Plan the drives between today's calendar events (or a given range) and propose changes.
  .post("/travel/plan", async (c) => {
    // The body is optional: no body plans today.
    const raw = await c.req.text();
    const input = parse(TravelPlanInput, raw.trim() ? await jsonBody(c) : {});
    return c.json(await travelPlanFor(input));
  });

/** Shared by the route and the MCP tool. Defaults to today in Europe/Athens. */
export async function travelPlanFor(input: TravelPlanInput) {
  const zone = new Zone(DEFAULT_TIMEZONE);
  const today = zone.dayOf(Date.now());
  const from = input.from ?? new Date(zone.startOfDay(today)).toISOString();
  const to = input.to ?? new Date(zone.startOfDay(zone.nextDay(today))).toISOString();
  if (!input.whole_day) return planTravel(store, { from, to });

  // The whole day: the drives go on the timeline, then one plan moves the user's own blocks.
  const day = zone.dayOf(Date.parse(from));
  const dayFrom = new Date(zone.startOfDay(day)).toISOString();
  const dayTo = new Date(zone.startOfDay(zone.nextDay(day))).toISOString();
  const result: TravelPlanResult = await planTravel(store, { from: dayFrom, to: dayTo, propose: false });
  const empty = { day, before_minutes: 0, after_minutes: 0, won_minutes: 0, moves: [], drives: [] };
  if (result.status === "maps_unavailable") {
    return {
      ...result,
      day: { ...empty, recommendation_id: null, note: "Travel times need maps set up on the server." },
    };
  }
  if (result.status === "travel_off") {
    return {
      ...result,
      day: { ...empty, recommendation_id: null, note: "Travel times are off. Turn them on in Places." },
    };
  }
  const plan = await planWholeDay(store, { day });
  if (plan.recommendation_id) {
    const rec = await store.getRecommendation(plan.recommendation_id);
    if (rec && !result.recommendations.some((r) => r.id === rec.id)) result.recommendations.push(rec);
  }
  return { ...result, day: plan };
}
