import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen";
import { formatWeekday } from "@/lib/format";

export default function GoalsPage() {
  return (
    <main className="screen">
      <ScreenHeader context={formatWeekday(new Date())} title="Goals" />
      <EmptyState title="No goals yet.">
        Tell Michael what you're working towards and how many hours a week it needs.
      </EmptyState>
    </main>
  );
}
