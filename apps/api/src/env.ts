import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().default(8787),
  // Shared secret for collectors, webhooks and the demo connector; requests with it act as the demo user.
  API_KEY: z.string().min(1).default("dev-key"),
  // The demo account (Supabase Auth user) that API-key requests act for.
  DEMO_USER_ID: z.uuid().default("2ee12960-e594-456d-85cb-a672d0ff3ac3"),
  // Comma-separated origins allowed by CORS (the web app).
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  // Public base URL of this API, used for OAuth redirect URIs.
  PUBLIC_API_URL: z.string().default("http://localhost:8787"),
  // Public URL of the web app, where MCP OAuth sends the user to allow a connection.
  // Optional: defaults to the first non local entry of WEB_ORIGIN.
  PUBLIC_WEB_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  // Claude for chat. Without a key POST /v1/chat answers 503 unavailable instead of crashing.
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
  // Google Maps Platform (Routes API + Geocoding API), server side only. Empty = no travel times.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof Env>;
export const env: Env = Env.parse(process.env);

export const webUrl = () => (env.WEB_URL ?? env.WEB_ORIGIN.split(",")[0] ?? "").trim().replace(/\/$/, "");

if (env.API_KEY === "dev-key" && process.env.NODE_ENV === "production") {
  throw new Error("API_KEY must be set in production");
}
