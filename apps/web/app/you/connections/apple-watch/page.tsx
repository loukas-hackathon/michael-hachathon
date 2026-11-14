import { AppleWatchSetup } from "@/components/setup/apple-watch-setup";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Apple Watch · Michael" };

export default async function AppleWatchPage() {
  const { row } = await getConnection("apple-watch");
  const c = connection("apple-watch");
  return (
    <ConnectionPage row={row}>
      <SetupSection
        title="Set up"
        note="Health Auto Export is a paid app on the App Store. It reads Apple Health on your iPhone, where your watch saves everything."
      >
        <AppleWatchSetup />
      </SetupSection>
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
