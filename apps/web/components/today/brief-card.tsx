import { getLatestBrief } from "@/lib/analysis";
import { BriefView } from "./brief-view";

/** Michael's latest brief with a button to ask for a fresh one. Nothing on sample days. */
export async function BriefCard({ sample }: { sample: boolean }) {
  if (sample) return null;
  const latest = await getLatestBrief();
  return (
    <BriefView
      initial={latest?.run.status === "succeeded" ? latest.run : null}
      initialSuggestions={latest?.recommendations.length ?? 0}
    />
  );
}
