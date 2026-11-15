import { getLatestBrief } from "@/lib/analysis";
import { BriefView } from "./brief-view";

/**
 * Michael's latest brief with a button to ask for a fresh one. Nothing on sample days. `empty`:
 * the row's line before the first brief, from the person's week (noBriefLine in lib/today-lines).
 */
export async function BriefCard({ sample, empty }: { sample: boolean; empty?: string }) {
  if (sample) return null;
  const latest = await getLatestBrief();
  return (
    <BriefView
      initial={latest?.run.status === "succeeded" ? latest.run : null}
      initialSuggestions={latest?.recommendations.length ?? 0}
      empty={empty}
    />
  );
}
