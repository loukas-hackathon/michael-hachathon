import { Hono } from "hono";
import { notImplemented } from "../http";

// Per-source ingest webhooks. Each maps a provider payload to EventInput[] and calls store.insertEvents.
export const webhooks = new Hono()
  .post("/omi", notImplemented("Omi webhook"))
  .post("/health-auto-export", notImplemented("Health Auto Export webhook"))
  .post("/ios-shortcuts", notImplemented("iOS Shortcuts webhook"))
  .post("/activitywatch", notImplemented("ActivityWatch webhook"));
