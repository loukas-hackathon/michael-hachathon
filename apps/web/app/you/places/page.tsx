import Link from "next/link";
import { PlacesEditor } from "@/components/you/places-editor";
import { getPlaceSuggestions, getPlaces, getPrivacy } from "@/lib/api";

export const metadata = { title: "Places · Michael" };

// Home, work, gym and university, found by address search on the server, and the Travel times
// switch. Michael plans drives between these and the places in your calendar.
export default async function PlacesPage() {
  const [places, privacy, suggestions] = await Promise.all([
    getPlaces().catch(() => null),
    getPrivacy().catch(() => null),
    getPlaceSuggestions().catch(() => null),
  ]);
  const maps = privacy?.sources.find((s) => s.source === "maps");

  return (
    <main className="screen">
      <header className="flex min-h-11 items-center justify-end pt-2">
        <Link
          href="/you/connections/travel"
          className="press -mr-2 flex h-11 items-center px-2 text-body font-semibold text-tint-text"
        >
          Done
        </Link>
      </header>
      <h1 className="text-large-title font-bold tracking-[0.01em]">Places</h1>
      <p className="mt-1 text-subhead text-label-2">
        I plan your drives between these, and move your own blocks out of the rush.
      </p>
      {places ? (
        <PlacesEditor
          places={places.places}
          mapsAvailable={places.maps_available}
          travelEnabled={maps?.enabled ?? places.travel_enabled}
          suggestions={suggestions?.enabled ? suggestions.suggestions : []}
        />
      ) : (
        <p role="alert" className="mt-6 text-subhead text-label-2">
          I could not load your places. Try again in a minute.
        </p>
      )}
    </main>
  );
}
