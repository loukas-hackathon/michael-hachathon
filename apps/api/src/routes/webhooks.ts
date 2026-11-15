import { Hono } from "hono";
import { currentUserId } from "../context";
import { jsonBody, parse } from "../http";
import { AwPayload, mapActivityWatch } from "../ingest/activitywatch";
import { collecting, ignoredResponse, ingest } from "../ingest/common";
import { HaePayload, mapHealthAutoExport } from "../ingest/health-auto-export";
import { ShortcutsPairer, ShortcutsPayload } from "../ingest/ios-shortcuts";
import { mapOmi } from "../ingest/omi";
import { phoneLive } from "../ingest/phone-live";
import { claudeCodeHook } from "./claude-code";

const shortcuts = new ShortcutsPairer();

// Per-source ingest webhooks. Each maps a provider payload to EventInput[] (apps/api/src/ingest/)
// and stores it through the Store, scoped to the caller resolved by auth. Payloads: docs/api.md.
export const webhooks = new Hono()
  .post("/omi", async (c) => {
    // Any JSON is accepted: Omi also sends transcript batches and day summaries, kept out on purpose.
    const event = mapOmi(await jsonBody(c));
    return c.json(await ingest(event ? [event] : []));
  })
  .post("/health-auto-export", async (c) => {
    const payload = parse(HaePayload, await jsonBody(c));
    const { events, skipped_metrics } = mapHealthAutoExport(payload, Date.now());
    // Metrics we do not keep, so the export can be trimmed in the app.
    if (skipped_metrics.length) c.header("x-michael-skipped-metrics", skipped_metrics.join(","));
    return c.json(await ingest(events));
  })
  .post("/ios-shortcuts", async (c) => {
    const payload = parse(ShortcutsPayload, await jsonBody(c));
    // Checked first so an open is not even held while off the record or with the source off.
    if (!(await collecting("ios_shortcuts"))) {
      return c.json({
        ...ignoredResponse(1),
        message: "Michael is not keeping iPhone app opens: you are off the record or switched it off.",
      });
    }
    // Run by hand in Shortcuts: the test. The key worked (auth already passed), so the iPhone row
    // turns Connected; app opens arrive once the App automation runs the shortcut (#466).
    if (!payload.app) {
      return c.json({
        ...ignoredResponse(0),
        test: true,
        message: "Connected to Michael. Now add the App automation so opens arrive.",
      });
    }
    // Kept live as well: the app in front now is not an event until the next open ends it (#438).
    phoneLive.record(currentUserId(), payload, Date.now());
    return c.json(await ingest(shortcuts.handle(currentUserId(), payload, Date.now())));
  })
  .post("/activitywatch", async (c) => {
    const payload = parse(AwPayload, await jsonBody(c));
    return c.json(await ingest(mapActivityWatch(payload, Date.now())));
  })
  .post("/claude-code", claudeCodeHook);
