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
 * developer's machine, never on a deployment (Vercel sets VERCEL_ENV, Railway sets RAILWAY_ENVIRONMENT).
 */
export const localFallbackAllowed = () =>
  process.env.NODE_ENV !== "production" || !(process.env.VERCEL_ENV || process.env.RAILWAY_ENVIRONMENT);

export const AUTH_MISSING_MESSAGE =
  "Sign in is not set up on this deployment. Michael is closed until it is.";

/** End-to-end tests (e2e/) sign in a fresh user with this cookie, holding the user's UUID. */
export const E2E_COOKIE = "michael_e2e_user";

/**
 * The test user in an e2e cookie, only when this server runs with E2E_TEST_AUTH=on. The API accepts
 * the resulting `e2e_<uuid>` token only on its in-memory store with the same flag, so it is inert
 * on every deployment.
 */
export const e2eTestUser = (value: string | undefined): string | null =>
  process.env.E2E_TEST_AUTH === "on" && value && UUID.test(value) ? value : null;
