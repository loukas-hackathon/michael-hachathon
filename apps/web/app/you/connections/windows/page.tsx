import Link from "next/link";
import { WindowsSetup } from "@/components/setup/windows-setup";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { CONNECTION_ROUTES, connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Windows PC · Michael" };

// A Windows PC (the Mac's twin): ActivityWatch notes the app in front, Michael's collector sends
// app names and times. One line in PowerShell sets up both (GET /v1/setup/windows.ps1).
export default async function WindowsPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const [{ row }, { from }] = await Promise.all([getConnection("windows"), searchParams]);
  const c = connection("windows");
  return (
    <ConnectionPage row={row} from={from}>
      <SetupSection
        title="Set up"
        note="It only reads. It never changes your files, and sends only to Michael."
      >
        <WindowsSetup />
      </SetupSection>
      <section className="px-4">
        <p className="text-subhead text-label-2">
          I get which app is in front and for how long, from ActivityWatch. App names only, never window
          titles. On a Mac?{" "}
          <Link href={CONNECTION_ROUTES.mac} className="font-semibold text-tint-text">
            Connect your Mac
          </Link>
          .
        </p>
      </section>
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
