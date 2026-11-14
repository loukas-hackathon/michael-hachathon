import type { Health } from "@michael/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requireUser } from "./auth";
import { env } from "./env";
import { errorResponse, HttpError } from "./http";
import { handleMcpRequest } from "./mcp";
import { analysis } from "./routes/analysis";
import { events } from "./routes/events";
import { goals } from "./routes/goals";
import { integrations, oauth } from "./routes/integrations";
import { patterns } from "./routes/patterns";
import { product } from "./routes/product";
import { recommendations } from "./routes/recommendations";
import { score } from "./routes/score";
import { webhooks } from "./routes/webhooks";
import { store } from "./store";

export const VERSION = "0.1.0";

// Webhook senders often cannot set headers, so they may pass ?key=. Mounted BEFORE v1 so the
// header-only middleware below never sees /v1/webhooks/* requests.
const webhooksApp = new Hono().use(requireUser({ allowQueryKey: true })).route("/", webhooks);

const v1 = new Hono()
  .use(requireUser())
  .route("/", events)
  .route("/", goals)
  .route("/", recommendations)
  .route("/", analysis)
  .route("/", patterns)
  .route("/", score)
  .route("/", integrations)
  .route("/", product);

export const app = new Hono()
  .use(logger())
  .use(cors({ origin: env.WEB_ORIGIN.split(",").map((s) => s.trim()) }))
  .get("/health", (c) => {
    const body: Health = {
      status: "ok",
      version: VERSION,
      time: new Date().toISOString(),
      storage: store.kind,
      commit: (process.env.GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA)?.slice(0, 7) ?? null,
    };
    return c.json(body);
  })
  .route("/v1", oauth)
  .route("/v1/webhooks", webhooksApp)
  .route("/v1", v1)
  // claude.ai custom connectors cannot send headers, so /mcp also accepts ?key=.
  .all("/mcp", requireUser({ allowQueryKey: true }), (c) => handleMcpRequest(c.req.raw))
  .notFound((c) => errorResponse(c, "not_found", `No route for ${c.req.method} ${c.req.path}`))
  .onError((err, c) => {
    if (err instanceof HttpError) return errorResponse(c, err.code, err.message, err.details);
    console.error(err);
    return errorResponse(c, "internal", "Internal server error");
  });
