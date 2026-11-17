import Link from "next/link";
import { MacSetup } from "@/components/setup/mac-setup";
import { SkipMacButton } from "@/components/setup/skip-mac-button";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { CONNECTION_ROUTES, connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Mac · Michael" };

export default async function MacPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const [{ row }, { from }] = await Promise.all([getConnection("mac"), searchParams]);
  const c = connection("mac");
  return (
    <ConnectionPage row={row} from={from}>
      <SetupSection
        title="Set up"
        note="It only reads. It never changes your files, and sends only to Michael."
      >
        <MacSetup />
      </SetupSection>
      {row.state === "none" || row.state === "optional" ? (
        <section className="px-4">
          <p className="text-subhead text-label-2">
            No Mac? Everything else works without one. Your{" "}
            <Link href={CONNECTION_ROUTES.iphone} className="font-semibold text-tint-text">
              iPhone
            </Link>{" "}
            can tell me which apps you open, live. On Windows?{" "}
            <Link href={CONNECTION_ROUTES.windows} className="font-semibold text-tint-text">
              Connect your PC
            </Link>
            .
          </p>
          {row.state === "none" ? <SkipMacButton /> : null}
        </section>
      ) : null}
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
