import { cache } from "react";
import { getGoals, getRecommendations } from "@/lib/api";
import { getOpenDrafts } from "@/lib/drafts";
import { bookedAhead, openRecommendations, type RecCard, toCard } from "@/lib/recommendations";
import { FollowUpRow } from "./follow-ups";
import { RecommendationList } from "./recommendation-list";

type Suggestions = { booked: RecCard | null; primary: RecCard | null; rest: RecCard[] };

/**
 * Today's suggestions, read once per request and split in three: the block just booked in chat or
 * through Claude that has not started (#330), the one thing to do now (the first suggestion Michael
 * can still do himself, else the first open one) and the rest. Null if none load.
 */
export const todaySuggestions = cache(async (): Promise<Suggestions> => {
  const now = new Date();
  const loaded = await Promise.all([getRecommendations(), getGoals()]).catch((err) => {
    console.error("recommendations panel:", err);
    return null;
  });
  if (!loaded) return { booked: null, primary: null, rest: [] };
  const [recs, goals] = loaded;
  const justBooked = bookedAhead(recs, now);
  const bookedCard = justBooked ? toCard(justBooked, goals, now) : null;
  // The done line under it already says until when: keep who asked, drop the repeat.
  const booked = bookedCard && {
    ...bookedCard,
    rationale: bookedCard.rationale.replace(/\s*Undo in Michael until it starts\.$/, ""),
  };
  const cards = openRecommendations(
    recs.filter((r) => r !== justBooked),
    now,
  ).map((r) => toCard(r, goals, now));
  const open = cards.filter((c) => c.status !== "done");
  const primary = open.find((c) => c.executable) ?? open[0] ?? null;
  return { booked, primary, rest: cards.filter((c) => c !== primary) };
});

/**
 * Today's suggestions with Do it, Undo and Not now. `booked` is the block just booked for the user,
 * as a done card with its Undo at the top of the screen; `primary` is the hero "Your next move"
 * with the screen's one filled button; `rest` is a quiet row under "More from Michael", followed by
 * the Follow ups row when drafts are waiting. Nothing if empty.
 */
export async function RecommendationsPanel({ slot }: { slot: "booked" | "primary" | "rest" }) {
  const { booked, primary, rest } = await todaySuggestions();
  // Always mounted, so the card can say "Undone" in place after the list no longer has it.
  if (slot === "booked") return <RecommendationList cards={booked ? [booked] : []} variant="booked" />;
  if (slot === "primary") return primary ? <RecommendationList cards={[primary]} variant="primary" /> : null;
  // The rest also carries the follow up drafts (#40), one more quiet row.
  const drafts = await getOpenDrafts().catch((err) => {
    console.error("follow ups:", err);
    return [];
  });
  return (
    <>
      {rest.length > 0 ? <RecommendationList cards={rest} variant="rest" /> : null}
      {drafts.length > 0 ? <FollowUpRow drafts={drafts.slice(0, 3)} /> : null}
    </>
  );
}
