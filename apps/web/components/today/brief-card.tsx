import { Suspense } from "react";
import { getLatestBrief } from "@/lib/analysis";
import { BriefView } from "./brief-view";

/**
 * Michael's latest brief with a button to ask for a fresh one. Nothing on sample days.
 * Streams in on its own (Suspense), so the score above never waits for it.
 */
export function BriefCard({ sample }: { sample: boolean }) {
  if (sample) return null;
  return (
    <Suspense fallback={null}>
      <BriefCardBody />
    </Suspense>
  );
}

async function BriefCardBody() {
  const latest = await getLatestBrief();
  return (
    <BriefView
      initial={latest?.run.status === "succeeded" ? latest.run : null}
      initialSuggestions={latest?.recommendations.length ?? 0}
    />
  );
}
