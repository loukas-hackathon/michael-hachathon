import { AnalysisTriggerInput } from "@michael/shared";
import { Hono } from "hono";
import { ModelNotConfiguredError, modelClient } from "../analysis/model";
import { runAnalysis } from "../analysis/run";
import { HttpError, parse } from "../http";
import { store } from "../store";

export const analysis = new Hono()
  // POST /v1/analysis/run  { from?, to?, trigger? }  (default: today so far in Europe/Athens, manual)
  .post("/analysis/run", async (c) => {
    // The body is optional: no body means every default.
    const text = await c.req.text();
    let raw: unknown = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new HttpError("bad_request", "Body must be valid JSON");
      }
    }
    const input = parse(AnalysisTriggerInput, raw);

    let model: ReturnType<typeof modelClient>;
    try {
      model = modelClient();
    } catch (err) {
      // No key on this server: say so, before any data is read (503, as the chat route does).
      if (err instanceof ModelNotConfiguredError) throw new HttpError("unavailable", err.message);
      throw err;
    }
    return c.json(await runAnalysis(input, { store, model }), 201);
  })
  .get("/analysis/latest", async (c) => {
    const run = await store.latestAnalysisRun();
    if (!run) throw new HttpError("not_found", "No analysis has run yet");
    const recs = await store.listRecommendations();
    return c.json({ run, recommendations: recs.filter((r) => r.analysis_run_id === run.id) });
  });
