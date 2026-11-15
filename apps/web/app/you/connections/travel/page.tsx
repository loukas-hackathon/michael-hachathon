import { WhereYouAre } from "@/components/location/where-you-are";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { PlacesEditor } from "@/components/you/places-editor";
import { getLocation, getPlaceSuggestions, getPlaces } from "@/lib/api";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Location · Michael" };

// Location: where you are on the timeline (this phone when you open Michael, the Mac's Wi-Fi),
// home, work and gym typed or taken from the phone in one tap, and the travel switch (#267).
export default async function LocationPage() {
  const [{ row }, places, suggestions, location] = await Promise.all([
    getConnection("travel"),
    getPlaces().catch(() => null),
    getPlaceSuggestions().catch(() => null),
    getLocation().catch(() => null),
  ]);
  return (
    <ConnectionPage row={row}>
      <SetupSection
        title="Where you are"
        note="Only near your saved places is a place named. Elsewhere I keep about a kilometre, never a trail."
      >
        <WhereYouAre status={location} places={places?.places ?? []} />
      </SetupSection>
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
