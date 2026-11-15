import { type Context, Hono } from "hono";
import { currentUserId } from "../context";
import { jsonBody, parse } from "../http";
import { AwPayload, mapActivityWatch } from "../ingest/activitywatch";
import { collecting, ignoredResponse, ingest } from "../ingest/common";
import { HaePayload, mapHealthAutoExport } from "../ingest/health-auto-export";
import { ShortcutsPairer, ShortcutsPayload } from "../ingest/ios-shortcuts";
import { mapOmi } from "../ingest/omi";
import { phoneLive } from "../ingest/phone-live";
import { personalTokenUsedBefore } from "../tokens";
import { claudeCodeHook } from "./claude-code";

const shortcuts = new ShortcutsPairer();

/** The key the caller sent, as auth read it (a bearer token, or ?key= on webhooks). */
const requestKey = (c: Context) =>
  c.req
    .header("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim() ?? c.req.query("key");

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
    // Checked first so nothing is stored or kept live while off the record or with the source off.
    if (!(await collecting("ios_shortcuts"))) {
      return c.json({
        ...ignoredResponse(1),
        message: "Michael is not keeping iPhone app opens: you are off the record or switched it off.",
      });
    }
    // No app: the key's first such call is the hand run test (#466). The key worked (auth already
    // passed), so the iPhone row turns Connected. After that, no app means an App automation, which
    // on current iOS hands the shortcut no input: stored as an open of an unnamed app. Callers
    // without a device key (the API key, curl) keep the old rule: no app is a test.
    if (!payload.app && personalTokenUsedBefore(requestKey(c)) !== true) {
      return c.json({
        ...ignoredResponse(0),
        test: true,
        message: "Connected to Michael. Now add the App automation so opens arrive.",
      });
    }
    // Kept live as well, for the real time nudges (#438), which read every signal in memory.
    phoneLive.record(currentUserId(), payload, Date.now());
    // Stored at once: an open is an event the moment it arrives, ended later by its close (#488).
    return c.json(await shortcuts.handle(payload, Date.now()));
  })
  .post("/activitywatch", async (c) => {
    const payload = parse(AwPayload, await jsonBody(c));
    return c.json(await ingest(mapActivityWatch(payload, Date.now())));
  })
  .post("/claude-code", claudeCodeHook);
