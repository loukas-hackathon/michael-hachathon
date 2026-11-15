import { AppleWatchSetup } from "@/components/setup/apple-watch-setup";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Apple Watch · Michael" };

// ?preview=1 shows the steps while CONNECTOR_STATUS still says Coming soon, so a person can prove
// the whole path on production (a real event arrives) before switching it on (#306). Nothing links
// here with it: everyone else sees Coming soon.
export default async function AppleWatchPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; preview?: string }>;
}) {
  const { from, preview } = await searchParams;
  const { row } = await getConnection("apple-watch", { preview: preview === "1" });
  const c = connection("apple-watch");
  return (
    <ConnectionPage row={row} from={from}>
      <SetupSection
        title="Set up"
        note="Health Auto Export reads Apple Health on your iPhone, where your watch saves everything. Free for 7 days, then Premium from about €2 a month or €25 once."
      >
        <AppleWatchSetup />
      </SetupSection>
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
