// Shared by the proxy and server code (no "server-only": the proxy imports it too).

/**
 * "See the demo week": the cookie holds one anonymous visitor id (a random UUID). The server
 * sends it to the API with the API key, so each visitor has a chat of their own and cannot change
 * the shared demo account. A signed in session always wins over this cookie.
 */
export const DEMO_COOKIE = "michael_demo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The visitor id in a demo cookie value, or null (missing, or the old "1" from before #197). */
export const demoVisitorId = (value: string | undefined): string | null =>
  value && UUID.test(value) ? value : null;

/**
 * Without Supabase env every request would act as the demo account. That is only acceptable on a
 * developer's machine, never on a deployment (Vercel sets VERCEL_ENV).
 */
export const localFallbackAllowed = () => process.env.NODE_ENV !== "production" || !process.env.VERCEL_ENV;

export const AUTH_MISSING_MESSAGE =
  "Sign in is not set up on this deployment. Michael is closed until it is.";
