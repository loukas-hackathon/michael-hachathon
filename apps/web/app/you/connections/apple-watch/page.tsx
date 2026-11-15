import { AppleWatchSetup } from "@/components/setup/apple-watch-setup";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Apple Watch · Michael" };

// Live for everyone. ?preview=1 is kept harmless: it only matters if CONNECTOR_STATUS switches this
// back to Coming soon, when it still shows the steps so the path can be proven on production (#306).
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
