import { Hono } from "hono";
import { jsonBody, notImplemented, parse } from "../http";
import { ingest } from "../ingest/common";
import { HaePayload, mapHealthAutoExport } from "../ingest/health-auto-export";
import { claudeCodeHook } from "./claude-code";

// Per-source ingest webhooks. Each maps a provider payload to EventInput[] (apps/api/src/ingest/)
// and stores it through the Store, scoped to the caller resolved by auth.
export const webhooks = new Hono()
  .post("/omi", notImplemented("Omi webhook"))
  .post("/health-auto-export", async (c) => {
    const payload = parse(HaePayload, await jsonBody(c));
    const { events, skipped_metrics } = mapHealthAutoExport(payload, Date.now());
    // Metrics we do not keep, so the export can be trimmed in the app.
    if (skipped_metrics.length) c.header("x-michael-skipped-metrics", skipped_metrics.join(","));
    return c.json(await ingest(events));
  })
  .post("/ios-shortcuts", notImplemented("iOS Shortcuts webhook"))
  .post("/activitywatch", notImplemented("ActivityWatch webhook"))
  .post("/claude-code", claudeCodeHook);
