import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen";

export default function AgentsPage() {
  return (
    <main className="screen">
      <ScreenHeader context="Who asks about you" title="Agents" />
      <EmptyState title="No agent has asked about you yet.">
        When Claude or another agent asks Michael about you, you approve it here with one tap.
      </EmptyState>
    </main>
  );
}
