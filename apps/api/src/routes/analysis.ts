import { Hono } from "hono";
import { HttpError, notImplemented } from "../http";
import { store } from "../store";

export const analysis = new Hono()
  .post("/analysis/run", notImplemented("POST /v1/analysis/run"))
  .get("/analysis/latest", async (c) => {
    const run = await store.latestAnalysisRun();
    if (!run) throw new HttpError("not_found", "No analysis has run yet");
    const recs = await store.listRecommendations();
    return c.json({ run, recommendations: recs.filter((r) => r.analysis_run_id === run.id) });
  });
