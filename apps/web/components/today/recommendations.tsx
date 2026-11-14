import { cache } from "react";
import { getGoals, getRecommendations } from "@/lib/api";
import { openRecommendations, type RecCard, toCard } from "@/lib/recommendations";
import { RecommendationList } from "./recommendation-list";

/**
 * Today's suggestions, read once per request and split in two: the one thing to do now (the first
 * suggestion Michael can still do himself, else the first open one) and the rest. Null if none load.
 */
export const todaySuggestions = cache(async (): Promise<{ primary: RecCard | null; rest: RecCard[] }> => {
  const now = new Date();
  const loaded = await Promise.all([getRecommendations(), getGoals()]).catch((err) => {
    console.error("recommendations panel:", err);
    return null;
  });
  if (!loaded) return { primary: null, rest: [] };
  const [recs, goals] = loaded;
  const cards = openRecommendations(recs, now).map((r) => toCard(r, goals, now));
  const open = cards.filter((c) => c.status !== "done");
  const primary = open.find((c) => c.executable) ?? open[0] ?? null;
  return { primary, rest: cards.filter((c) => c !== primary) };
});

/**
 * Today's suggestions with Do it, Undo and Not now. `primary` is the hero "Your next move" with the
 * screen's one filled button; `rest` is a quiet row under "More from Michael". Nothing if empty.
 */
export async function RecommendationsPanel({ slot }: { slot: "primary" | "rest" }) {
  const { primary, rest } = await todaySuggestions();
  const cards = slot === "primary" ? (primary ? [primary] : []) : rest;
  if (cards.length === 0) return null;
  return <RecommendationList cards={cards} variant={slot} />;
}
