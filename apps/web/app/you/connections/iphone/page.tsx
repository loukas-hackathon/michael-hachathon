import { headers } from "next/headers";
import Link from "next/link";
import { AutomationApp } from "@/components/setup/automation-app";
import { FocusShortcutSetup } from "@/components/setup/focus-shortcut-setup";
import { IPhoneShortcutSetup } from "@/components/setup/iphone-shortcut-setup";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { KeySetup } from "@/components/you/key-setup";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { getProfile } from "@/lib/api";
import { CONNECTION_ROUTES, connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";
import { focusShortcutUrl } from "@/lib/dnd";
import { isIPhone, shortcutUrl } from "@/lib/one-tap";

export const metadata = { title: "iPhone · Michael" };

// Two ways in. Live, from the iPhone alone: the Michael shortcut tells me when an app opens.
// Screen Time history needs a Mac (Apple keeps it on the devices; the Mac collector reads the
// synced copy, a day behind). Without a Mac, or on the iPhone itself, the iPhone path leads and the
// Mac is a footnote; with a Mac, opened from the Mac, Screen Time leads.
// ?preview=1 is kept harmless: it only matters if CONNECTOR_STATUS switches the iPhone back to
// Coming soon, when it still shows the steps for proving on a real iPhone (#306, #303).
export default async function IPhonePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; preview?: string }>;
}) {
  const [{ from, preview }, h] = await Promise.all([searchParams, headers()]);
  const [{ row, view }, profile] = await Promise.all([
    getConnection("iphone", { preview: preview === "1" }),
    getProfile().catch(() => null),
  ]);
  const c = connection("iphone");
  const mac = view.rows.find((r) => r.id === "mac");
  const hasMac = mac?.state === "on" || mac?.state === "paused";
  const leadIPhone = !hasMac || isIPhone(h.get("user-agent") ?? "");

  const live = (
    <SetupSection
      key="live"
      title={leadIPhone ? "Live, from your iPhone" : "Live, with Shortcuts"}
      note={leadIPhone ? undefined : "Optional. Adds the apps you open as it happens."}
    >
      {leadIPhone ? (
        <p className="mb-3 px-4 text-subhead text-label-2">
          I see which apps you open and for how long, as it happens. No Mac needed.
        </p>
      ) : null}
      <IPhoneShortcutSetup
        shortcutUrl={shortcutUrl()}
        live={row.state === "on"}
        fallback={
          <KeySetup
            keyName="iPhone Shortcuts"
            copyAs={{ kind: "webhook", path: "ios-shortcuts" }}
            steps={[
              "In Shortcuts, tap Automation, then +, then App. Pick the apps, tick Is Opened and Run Immediately.",
              "Add Get Contents of URL and paste your link. Set Method to POST and add one field: app, with Shortcut Input.",
            ]}
          />
        }
      />
      {/* Apple passes an App automation no app name: the app it is for, one tap (#539). */}
      {profile ? <AutomationApp initial={profile.default_app} /> : null}
    </SetupSection>
  );

  const screenTime = (
    <SetupSection key="mac" title={leadIPhone ? "Have a Mac too?" : "Screen Time, from your Mac"}>
      <div className="rounded-group bg-fill px-4 py-4 text-subhead">
        {hasMac ? (
          <p>
            Your Mac is connected. Turn on Share Across Devices in Screen Time on your iPhone and your Mac,
            and it sends every iPhone app's time too, a day behind.
          </p>
        ) : (
          <>
            <p>It adds every app's time from Screen Time, a day behind.</p>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-label-2">
              <li>Turn on Share Across Devices in Screen Time, on your iPhone and your Mac.</li>
              <li>
                <Link href={CONNECTION_ROUTES.mac} className="font-semibold text-tint-text">
                  Connect your Mac
                </Link>
                .
              </li>
            </ol>
          </>
        )}
      </div>
    </SetupSection>
  );

  // Do Not Disturb, asked then done (#447): a second shortcut, next to the first.
  const doNotDisturb = (
    <SetupSection
      key="dnd"
      title="Do Not Disturb, when you say yes"
      note="I ask in a nudge. One tap and it is on until your block ends, or until morning at night."
    >
      <FocusShortcutSetup url={focusShortcutUrl()} />
    </SetupSection>
  );

  return (
    <ConnectionPage row={row} from={from}>
      {leadIPhone ? [live, doNotDisturb, screenTime] : [screenTime, live, doNotDisturb]}
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
