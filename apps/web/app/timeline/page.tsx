import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen";
import { formatMonth } from "@/lib/format";

export default function TimelinePage() {
  return (
    <main className="screen">
      <ScreenHeader context={formatMonth(new Date())} title="Timeline" />
      <EmptyState title="Your day, hour by hour.">
        Every source you connect writes into one timeline here: your watch, calendar, Mac and iPhone.
      </EmptyState>
    </main>
  );
}
