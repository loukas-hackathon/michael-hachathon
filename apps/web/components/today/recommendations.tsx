import { getGoals, getRecommendations } from "@/lib/api";
import { openRecommendations, toCard } from "@/lib/recommendations";
import { RecommendationList } from "./recommendation-list";

/** Today's "Michael suggests": open recommendations with Do it, Undo and Not now. Nothing if none load. */
export async function RecommendationsPanel() {
  const now = new Date();
  const loaded = await Promise.all([getRecommendations(), getGoals()]).catch((err) => {
    console.error("recommendations panel:", err);
    return null;
  });
  if (!loaded) return null;
  const [recs, goals] = loaded;
  const cards = openRecommendations(recs, now).map((r) => toCard(r, goals, now));
  if (cards.length === 0) return null;
  return <RecommendationList cards={cards} />;
}
