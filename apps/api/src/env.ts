import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().default(8787),
  // Shared secret for collectors, webhooks and the demo connector; requests with it act as the demo user.
  API_KEY: z.string().min(1).default("dev-key"),
  // The demo account (Supabase Auth user) that API-key requests act for.
  DEMO_USER_ID: z.uuid().default("2ee12960-e594-456d-85cb-a672d0ff3ac3"),
  // "on": the demo account carries the generated demo week (src/demo), kept up to now. "off": not.
  DEMO_WEEK: z.enum(["on", "off"]).default("on"),
  // End-to-end tests only (e2e/): "on" accepts `Bearer e2e_<uuid>` as that user, so the suite can
  // sign in a fresh, non demo user without Supabase. Ignored unless the store is in memory.
  E2E_TEST_AUTH: z.enum(["on", "off"]).default("off"),
  // Comma-separated origins allowed by CORS (the web app).
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  // Public base URL of this API, used for OAuth redirect URIs.
  PUBLIC_API_URL: z.string().default("http://localhost:8787"),
  // Public URL of the web app, where MCP OAuth sends the user to allow a connection.
  // Optional: defaults to the first non local entry of WEB_ORIGIN.
  PUBLIC_WEB_URL: z.string().optional(),
  // Where the Mac installer (GET /v1/setup/mac.sh) downloads the collector from: a public GitHub
  // repository (owner/name) and a branch or tag.
  COLLECTOR_REPO: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .default("loukas-hackathon/michael-hachathon"),
  COLLECTOR_REF: z
    .string()
    .regex(/^[\w./-]+$/)
    .default("main"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  // Claude for chat and for the analysis. Without a key POST /v1/chat and POST /v1/analysis/run
  // answer 503 unavailable; nothing crashes at start-up.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  // Google Calendar OAuth (web application client). Redirect URI: ${PUBLIC_API_URL}/oauth/google/callback
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Where OAuth callbacks send the browser back to. Defaults to the first WEB_ORIGIN.
  WEB_URL: z.string().optional(),
  // Minutes between background calendar syncs for every connected user; 0 turns it off.
  CALENDAR_SYNC_MINUTES: z.coerce.number().int().nonnegative().default(15),
  // Web Push (nudges to iPhone, Apple Watch and browsers). Generate with `npx web-push generate-vapid-keys`.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // Contact for push services, a mailto: or https: URL.
  VAPID_SUBJECT: z.string().default("mailto:team@michael.app"),
  // Runs the nudge check for active users on an interval. Default: on in production only.
  SCHEDULER_ENABLED: z
    .enum(["true", "false", ""])
    .optional()
    .transform((v) => (v ? v === "true" : process.env.NODE_ENV === "production")),
  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().positive().default(5),
  // Telegram bot for nudges (backup to Web Push). Token from BotFather; without it the channel is off.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // The bot's @username without the @. Empty: asked from Telegram (getMe) once.
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  // Checked on every webhook call (X-Telegram-Bot-Api-Secret-Token). Empty: derived from the token.
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  // Google Maps Platform (Routes API + Geocoding API), server side only. Empty = no travel times.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  // ElevenLabs voice for POST /v1/voice/speak (free tier is enough). Without a key the route answers
  // 503 and the app speaks with the browser's own voice.
  ELEVENLABS_API_KEY: z.string().optional(),
  // "George": warm, calm, middle aged British male from the ElevenLabs default voices.
  ELEVENLABS_VOICE_ID: z.string().default("JBFqnCBsd6RMkjVDRZzb"),
  // Built-in voice used when ElevenLabs refuses the chosen one (401/402: a Voice Library voice on
  // the free plan). Default "George", which every plan can use.
  ELEVENLABS_FALLBACK_VOICE_ID: z.string().default("JBFqnCBsd6RMkjVDRZzb"),
  ELEVENLABS_MODEL: z.string().default("eleven_flash_v2_5"),
});

export type Env = z.infer<typeof Env>;
export const env: Env = Env.parse(process.env);

export const webUrl = () => (env.WEB_URL ?? env.WEB_ORIGIN.split(",")[0] ?? "").trim().replace(/\/$/, "");

if (env.API_KEY === "dev-key" && process.env.NODE_ENV === "production") {
  throw new Error("API_KEY must be set in production");
}

if (env.E2E_TEST_AUTH === "on" && (env.SUPABASE_URL || process.env.NODE_ENV === "production")) {
  throw new Error("E2E_TEST_AUTH is for the in-memory test API only");
}
