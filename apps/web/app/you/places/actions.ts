"use server";

import { type AddressMatch, PlaceInput } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { putPlaces, searchPlaces } from "@/lib/api";
import { PLACES_PATH } from "@/lib/places-path";

// Server functions behind the Places screen. The API geocodes; the browser never sees a maps key.

export type SearchResult = { ok: true; results: AddressMatch[]; mapsAvailable: boolean } | { ok: false };

export async function findAddress(q: string): Promise<SearchResult> {
  const query = typeof q === "string" ? q.slice(0, 200).trim() : "";
  if (query.length < 3) return { ok: true, results: [], mapsAvailable: true };
  try {
    const r = await searchPlaces(query);
    return { ok: true, results: r.results, mapsAvailable: r.maps_available };
  } catch {
    return { ok: false };
  }
}

export type SaveResult = { ok: true } | { ok: false; message: string };

/** Replaces the whole list (PUT /v1/places). */
export async function savePlaceList(places: unknown): Promise<SaveResult> {
  const parsed = PlaceInput.array().max(20).safeParse(places);
  if (!parsed.success) return { ok: false, message: "That address doesn't look right." };
  const res = await putPlaces({ places: parsed.data });
  if (!res.ok) return res;
  revalidatePath(PLACES_PATH);
  revalidatePath("/you");
  revalidatePath("/you/connections/travel");
  return { ok: true };
}
