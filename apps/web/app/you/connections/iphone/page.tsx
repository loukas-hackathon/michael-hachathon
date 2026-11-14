import Link from "next/link";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { KeySetup } from "@/components/you/key-setup";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { CONNECTION_ROUTES, connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "iPhone screen time · Michael" };

export default async function IPhonePage() {
  const { row } = await getConnection("iphone");
  const c = connection("iphone");
  return (
    <ConnectionPage row={row}>
      <SetupSection title="Screen Time, every day">
        <div className="rounded-group bg-fill px-4 py-4">
          <ol className="list-decimal space-y-2 pl-5 text-subhead">
            <li>On your iPhone, open Settings, Screen Time and turn on Share Across Devices.</li>
            <li>Do the same on your Mac, in System Settings, Screen Time.</li>
            <li>
              Connect your{" "}
              <Link href={CONNECTION_ROUTES.mac} className="font-semibold text-tint-text">
                Mac
              </Link>
              . It sends your iPhone apps too, about a day behind.
            </li>
          </ol>
        </div>
      </SetupSection>
      <SetupSection
        title="Live, with Shortcuts"
        note="Optional. One automation per app you want me to watch, such as Instagram or YouTube."
      >
        <KeySetup
          keyName="iPhone Shortcuts"
          copyAs={{ kind: "webhook", path: "ios-shortcuts" }}
          steps={[
            "In Shortcuts, tap Automation, +, App. Choose the apps, tick Is Opened, Run Immediately.",
            "Add Get Contents of URL, paste it as the URL. Method POST, Request Body JSON.",
            "Add two fields: app with Shortcut Input, and action with open. Repeat with Is Closed and close.",
          ]}
        />
      </SetupSection>
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
