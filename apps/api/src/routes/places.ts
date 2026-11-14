import { type Place, type PlacesResponse, PlacesUpdate, TravelPlanInput } from "@michael/shared";
import { Hono } from "hono";
import { jsonBody, parse } from "../http";
import { geocode, mapsAvailable } from "../integrations/maps";
import { planTravel } from "../integrations/travel";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { Zone } from "../patterns/time";
import { store } from "../store";

// Saved places and travel times (docs/api.md, Places and travel).

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
      rows.push({ key: p.key, label: p.label ?? DEFAULT_LABEL[p.key] ?? p.key, address, lat, lng });
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
  return planTravel(store, { from, to });
}
