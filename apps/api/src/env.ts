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
});

export type Env = z.infer<typeof Env>;
export const env: Env = Env.parse(process.env);

if (env.API_KEY === "dev-key" && process.env.NODE_ENV === "production") {
  throw new Error("API_KEY must be set in production");
}
