import type { Source } from "@michael/shared";
import { SourceSwitches } from "@/app/you/source-switches";
import { getPrivacy } from "@/lib/api";
import { SetupSection } from "./connection-page";

// The privacy switches a connection owns, on its own page: one place per source.
export async function SourcePrivacy({ sources, note }: { sources: Source[]; note?: string }) {
  const privacy = await getPrivacy().catch(() => null);
  return (
    <SetupSection
      title="What I read"
      note={note ?? "Switch one off and I stop reading it at once. Off the record on You stops everything."}
    >
      {privacy ? (
        <SourceSwitches initial={privacy.sources} sources={sources} />
      ) : (
        <p className="rounded-group bg-fill px-4 py-3 text-subhead text-label-2">
          I could not load these switches. Pull to refresh.
        </p>
      )}
    </SetupSection>
  );
}
