import { TelegramRow } from "@/app/you/telegram";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Telegram · Michael" };

export default async function TelegramPage() {
  const { row } = await getConnection("telegram");
  return (
    <ConnectionPage row={row}>
      <SetupSection
        title="Your chat"
        note="The same nudges as on your phone, never more than five a day. Disconnect any time."
      >
        <div className="overflow-hidden rounded-group bg-fill">
          <TelegramRow />
        </div>
      </SetupSection>
      <SetupSection title="How">
        <ol className="list-decimal space-y-2 rounded-group bg-fill py-4 pr-4 pl-9 text-subhead">
          <li>Tap Connect. Telegram opens Michael's bot.</li>
          <li>Tap Start. That is all: the link works once and only for you.</li>
        </ol>
      </SetupSection>
    </ConnectionPage>
  );
}
