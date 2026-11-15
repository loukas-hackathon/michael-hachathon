import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { PlacesEditor } from "@/components/you/places-editor";
import { getPlaceSuggestions, getPlaces } from "@/lib/api";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Location · Michael" };

// Location: home, work and gym, typed or taken from the phone in one tap, and the travel switch.
// Michael plans drives between these and the places in your calendar.
export default async function LocationPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const [{ row }, places, suggestions] = await Promise.all([
    getConnection("travel"),
    getPlaces().catch(() => null),
    getPlaceSuggestions().catch(() => null),
  ]);
  return (
    <ConnectionPage row={row} from={from}>
      <SetupSection title="Your places">
        {places ? (
          <PlacesEditor
            places={places.places}
            mapsAvailable={places.maps_available}
            travelEnabled={places.travel_enabled}
            suggestions={suggestions?.enabled ? suggestions.suggestions : []}
          />
        ) : (
          <p className="rounded-group bg-fill px-4 py-3 text-subhead text-label-2">
            I could not load your places. Pull to refresh.
          </p>
        )}
      </SetupSection>
    </ConnectionPage>
  );
}
