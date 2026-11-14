import { GoogleCalendarRow } from "@/app/you/google-calendar";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { SourcePrivacy } from "@/components/you/source-privacy";
import { connection } from "@/lib/connections";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Google Calendar · Michael" };

export default async function GoogleCalendarPage() {
  const { row } = await getConnection("google-calendar");
  const c = connection("google-calendar");
  return (
    <ConnectionPage row={row}>
      <SetupSection
        title="Your calendar"
        note="One tap, then pick your Google account. I read your plans and only ever move blocks you made alone. Never a meeting with other people."
      >
        <div className="overflow-hidden rounded-group bg-fill">
          <GoogleCalendarRow />
        </div>
      </SetupSection>
      <SourcePrivacy sources={c.sources} />
    </ConnectionPage>
  );
}
