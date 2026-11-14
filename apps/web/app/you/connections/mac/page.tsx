import { MacSetup } from "@/components/setup/mac-setup";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Mac · Michael" };

export default async function MacPage() {
  const { row } = await getConnection("mac");
  const c = connection("mac");
  return (
    <ConnectionPage row={row}>
      <SetupSection
        title="Set up"
        note="It only reads. It never changes your files, and sends only to Michael."
      >
        <MacSetup />
      </SetupSection>
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
