import type { Health } from "@michael/shared";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requireUser } from "./auth";
import { env } from "./env";
import { errorResponse, HttpError } from "./http";
import { handleMcpRequest } from "./mcp";
import { actions } from "./routes/actions";
import { agents } from "./routes/agents";
import { analysis } from "./routes/analysis";
import { blocks } from "./routes/blocks";
import { chat } from "./routes/chat";
import { chatThreads } from "./routes/chat-threads";
import { checkIn } from "./routes/check-in";
import { checklist } from "./routes/checklist";
import { demo } from "./routes/demo";
import { drafts } from "./routes/drafts";
import { events } from "./routes/events";
import { focusGuards } from "./routes/focus-guards";
import { goals } from "./routes/goals";
import { instructions } from "./routes/instructions";
import { integrations, oauth } from "./routes/integrations";
import { log } from "./routes/log";
import { meData } from "./routes/me-data";
import { moments } from "./routes/moments";
import { nudges } from "./routes/nudges";
import { connect, oauthPublic } from "./routes/oauth";
import { patterns } from "./routes/patterns";
import { places } from "./routes/places";
import { privacy } from "./routes/privacy";
import { product } from "./routes/product";
import { profile } from "./routes/profile";
import { push } from "./routes/push";
import { recommendations } from "./routes/recommendations";
import { ritual } from "./routes/ritual";
import { score } from "./routes/score";
import { setupPublic, setupTokens } from "./routes/setup";
import { sources } from "./routes/sources";
import { targets } from "./routes/targets";
import { telegram, telegramWebhook } from "./routes/telegram";
import { tokens } from "./routes/tokens";
import { voice } from "./routes/voice";
import { webhooks } from "./routes/webhooks";
import { week } from "./routes/week";
import { store } from "./store";
import { runTimed, serverTimingEntries } from "./timing";

export const VERSION = "0.1.0";

// Webhook senders often cannot set headers, so they may pass ?key=. Mounted BEFORE v1 so the
// header-only middleware below never sees /v1/webhooks/* requests.
const webhooksApp = new Hono().use(requireUser({ allowQueryKey: true })).route("/", webhooks);

// Every /v1 route, without the auth in front (the isolation test mounts it as several users).
export const v1Routes = new Hono()
  .route("/", events)
  .route("/", goals)
  .route("/", checklist)
  .route("/", ritual)
  .route("/", instructions)
  .route("/", recommendations)
  .route("/", analysis)
  .route("/", patterns)
  .route("/", score)
  .route("/", log)
  .route("/", targets)
  .route("/", chatThreads)
  .route("/", chat)
  .route("/", checkIn)
  .route("/", moments)
  .route("/", week)
  .route("/", voice)
  .route("/", integrations)
  .route("/", privacy)
  .route("/", sources)
  .route("/", nudges)
  .route("/", push)
  .route("/", actions)
  .route("/", blocks)
  .route("/", focusGuards)
  .route("/", drafts)
  .route("/", profile)
  .route("/", product)
  .route("/", tokens)
  .route("/", setupTokens)
  .route("/", telegram)
  .route("/", connect)
  .route("/", agents)
  .route("/", places)
  .route("/", meData)
  .route("/", demo);

const v1 = new Hono().use(requireUser()).route("/", v1Routes);

export const app = new Hono()
  .use(logger())
  // Server time and region on every response, so latency can be measured from anywhere (#229).
  // Database round trips and auth time too (#234): `db;desc="3 round trips";dur=290`.
  .use(async (c, next) => {
    const start = performance.now();
    const { t, result } = runTimed(() => next());
    await result;
    const region = process.env.RAILWAY_REPLICA_REGION ?? "local";
    c.res.headers.append("Server-Timing", `app;dur=${(performance.now() - start).toFixed(1)}`);
    for (const entry of serverTimingEntries(t)) c.res.headers.append("Server-Timing", entry);
    c.res.headers.append("Server-Timing", `region;desc="${region}"`);
  })
  // gzip for the REST API's JSON (#298): a week's timeline or score is hundreds of KB. Only
  // application/json under /v1, so the chat's event stream is never buffered by the compressor,
  // and MCP (/mcp) and OAuth answer exactly as before.
  .use("/v1/*", compress({ contentTypeFilter: /^application\/json/i }))
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
  // MCP OAuth: discovery, client registration, authorise and token (public by design).
  .route("/", oauthPublic)
  // Google Calendar OAuth callback (/oauth/google/callback), validated by its signed state.
  .route("/", oauth)
  // Telegram's bot webhook carries no user: verified by its secret token, before the auth below.
  .route("/v1/webhooks/telegram", telegramWebhook)
  .route("/v1/webhooks", webhooksApp)
  // One tap setup: the token exchange and the Mac installer carry no user; the setup token is the key.
  .route("/v1", setupPublic)
  .route("/v1", v1)
  // claude.ai signs in with OAuth (routes/oauth.ts); the API key and ?key= keep working.
  .all("/mcp", requireUser({ mcp: true }), (c) => handleMcpRequest(c.req.raw))
  .notFound((c) => errorResponse(c, "not_found", `No route for ${c.req.method} ${c.req.path}`))
  .onError((err, c) => {
    if (err instanceof HttpError) return errorResponse(c, err.code, err.message, err.details);
    console.error(err);
    return errorResponse(c, "internal", "Internal server error");
  });
