import type { InsightsRunResponse } from "@michael/shared";
import { Hono } from "hono";
import { applyFix, insightsFor, runInsights, undoFix } from "../insights/service";

// What Michael has learnt by studying the user (docs/api.md, "Insights"). Every figure is worked
// out from the caller's own events (apps/api/src/insights); the store scopes every read.
export const insights = new Hono()
  // GET /v1/insights
  .get("/insights", async (c) => c.json(await insightsFor()))
  // POST /v1/insights/run  (study again now; the discovery pass runs behind the answer)
  .post("/insights/run", async (c) => {
    const body: InsightsRunResponse = { status: (await runInsights()).status };
    return c.json(body, 202);
  })
  // POST /v1/insights/:id/fix  (ids carry ":" and ">": send them URL encoded)
  .post("/insights/:id/fix", async (c) => c.json(await applyFix(c.req.param("id"))))
  // DELETE /v1/insights/:id/fix
  .delete("/insights/:id/fix", async (c) => c.json(await undoFix(c.req.param("id"))));
