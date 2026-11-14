import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { Places } from "@/components/you/places";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { getPlaces } from "@/lib/api";
import { connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Travel times · Michael" };

export default async function TravelPage() {
  const [{ row }, places] = await Promise.all([getConnection("travel"), getPlaces().catch(() => null)]);
  const c = connection("travel");
  return (
    <ConnectionPage row={row}>
      <SetupSection
        title="Your places"
        note="I check the traffic between these and your plans, and tell you when leaving later wins time."
      >
        {places ? (
          <Places
            places={places.places}
            mapsAvailable={places.maps_available}
            travelEnabled={places.travel_enabled}
          />
        ) : (
          <p className="rounded-group bg-fill px-4 py-3 text-subhead text-label-2">
            I could not load your places. Pull to refresh.
          </p>
        )}
      </SetupSection>
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
