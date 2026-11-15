import { mockInsights } from "@michael/shared";
import type { Insights } from "../insights";

// What a new account sees before Michael can call anything a pattern (#432), built from the
// contract's example (mockInsights in @michael/shared): ?demo=studying and ?demo=watching.

/** Night 3: nothing yet but the count. */
export const sampleInsightsStudying: Insights = {
  ...mockInsights,
  studied: {
    ...mockInsights.studied,
    days: 3,
    nights: 3,
    data_points: 61,
    sources: ["apple-watch", "iphone"],
  },
  insights: [],
  series: [],
};

/** Week two: first things seen, nothing held often enough yet. */
export const sampleInsightsWatching: Insights = {
  ...mockInsights,
  studied: { ...mockInsights.studied, days: 9, nights: 9, data_points: 174 },
  insights: mockInsights.insights.slice(0, 2).map((i) => ({
    ...i,
    status: "watching" as const,
    evidence: {
      ...i.evidence,
      times_held: 2,
      times_seen: 2,
      history: i.evidence.history.slice(-2),
      days: i.evidence.days.slice(-2),
    },
  })),
  series: [],
};
