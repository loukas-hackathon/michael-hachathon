import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { KeySetup } from "@/components/you/key-setup";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Apple Watch · Michael" };

export default async function AppleWatchPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const [{ row }, { from }] = await Promise.all([getConnection("apple-watch"), searchParams]);
  const c = connection("apple-watch");
  return (
    <ConnectionPage row={row} from={from}>
      <SetupSection
        title="Set up"
        note="Health Auto Export is a paid app on the App Store. It reads Apple Health on your iPhone, where your watch saves everything."
      >
        <KeySetup
          keyName="Health Auto Export"
          copyAs={{ kind: "webhook", path: "health-auto-export" }}
          steps={[
            "On your iPhone, open Health Auto Export, then Automations, New, REST API.",
            "Paste it as the URL. Format JSON, every 5 minutes.",
            "Pick sleep, workouts, heart rate, HRV and steps. Save. Last data shows above within minutes.",
          ]}
        />
      </SetupSection>
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
