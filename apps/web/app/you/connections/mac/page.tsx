import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { KeySetup } from "@/components/you/key-setup";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Mac · Michael" };

export default async function MacPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const [{ row }, { from }] = await Promise.all([getConnection("mac"), searchParams]);
  const c = connection("mac");
  return (
    <ConnectionPage row={row} from={from}>
      <SetupSection
        title="Set up"
        note="It only reads. It never changes your files, and sends only to Michael. Our menu bar app replaces these steps soon."
      >
        <KeySetup
          keyName="Mac collector"
          copyAs={{ kind: "collector" }}
          steps={[
            "On your Mac, open Terminal in the Michael folder, paste and press Return.",
            "If macOS asks, allow Full Disk Access for Terminal in System Settings, Privacy and Security.",
            "Leave it running. Last data shows above within a minute.",
          ]}
        />
      </SetupSection>
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
