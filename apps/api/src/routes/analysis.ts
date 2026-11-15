import { AnalysisMode, AnalysisTriggerInput } from "@michael/shared";
import { Hono } from "hono";
import { ModelNotConfiguredError, modelClient } from "../analysis/model";
import { runAnalysis } from "../analysis/run";
import { runSpecialistAnalysis } from "../analysis/specialists";
import { HttpError, parse } from "../http";
import { store } from "../store";

export const analysis = new Hono()
  // POST /v1/analysis/run?mode=single|specialists  { from?, to?, trigger? }
  // (default: single pass, today so far in Europe/Athens, manual)
  .post("/analysis/run", async (c) => {
    const mode = parse(AnalysisMode, c.req.query("mode") ?? "single");
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
    const run = mode === "specialists" ? runSpecialistAnalysis : runAnalysis;
    return c.json(await run(input, { store, model }), 201);
  })
  .get("/analysis/latest", async (c) => {
    // Side by side (#298): the recommendations never wait for the run.
    const [run, recs] = await Promise.all([store.latestAnalysisRun(), store.listRecommendations()]);
    if (!run) throw new HttpError("not_found", "No analysis has run yet");
    return c.json({ run, recommendations: recs.filter((r) => r.analysis_run_id === run.id) });
  });
