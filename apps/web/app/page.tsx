import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen";
import { formatDay } from "@/lib/format";

export default function TodayPage() {
  return (
    <main className="screen">
      <ScreenHeader context={formatDay(new Date())} title="Today" />
      <EmptyState title="Nothing yet.">
        Wear the watch tonight and your first brief arrives in the morning.
      </EmptyState>
    </main>
  );
}
