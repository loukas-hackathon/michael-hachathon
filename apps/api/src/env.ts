import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().default(8787),
  // Provisional MVP auth: one shared secret, sent as `Authorization: Bearer <API_KEY>`.
  API_KEY: z.string().min(1).default("dev-key"),
  // Comma-separated origins allowed by CORS (the web app).
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  // Public base URL of this API, used for OAuth redirect URIs.
  PUBLIC_API_URL: z.string().default("http://localhost:8787"),
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
