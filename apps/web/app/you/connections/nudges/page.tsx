import { NudgesButton } from "@/app/you/nudges-button";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Nudges · Michael" };

export default async function NudgesPage() {
  const { row } = await getConnection("nudges");
  return (
    <ConnectionPage row={row}>
      <SetupSection title="This phone">
        <NudgesButton />
      </SetupSection>
      <SetupSection title="On iPhone">
        <ol className="list-decimal space-y-2 rounded-group bg-fill py-4 pr-4 pl-9 text-subhead">
          <li>Open Michael in Safari, tap Share, then Add to Home Screen.</li>
          <li>Open Michael from the Home Screen and come back here.</li>
          <li>Tap Turn on nudges and allow notifications. Your Apple Watch buzzes with them.</li>
        </ol>
      </SetupSection>
    </ConnectionPage>
  );
}
