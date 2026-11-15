import { type InsightsResponse, mockInsights } from "@michael/shared";
import { Hono } from "hono";

// What Michael has learnt by studying the user (docs/api.md, "Insights"). The contract first: this
// answers the example from the shared mocks until the engine (apps/api/src/insights) lands.
export const insights = new Hono()
  // GET /v1/insights
  .get("/insights", (c) => {
    const body: InsightsResponse = mockInsights;
    return c.json(body);
  });
