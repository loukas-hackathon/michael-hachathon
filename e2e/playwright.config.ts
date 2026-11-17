import { defineConfig, devices } from "@playwright/test";

// The demo path, end to end: the real web app (next start on a production build) against the real
// API on the in-memory store with the demo week. Hermetic: no Supabase, Google or Anthropic keys,
// and every request that leaves localhost is refused (tests/fixtures.ts).
// `pnpm e2e` at the repo root builds the web app first; CI builds it in its own step.

const API_PORT = Number(process.env.E2E_API_PORT ?? 18787);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 13000);
const API_URL = `http://127.0.0.1:${API_PORT}`;
// localhost, not 127.0.0.1: Next writes redirects (e.g. /auth/demo) for localhost, and the cookie
// must survive them.
const WEB_URL = `http://localhost:${WEB_PORT}`;

// The web app runs as on Vercel, with sign in configured, so "See the demo week" takes the real
// demo visitor path (read mostly). The Supabase URL is a closed local port: nothing leaves the
// machine, and with no session cookie the auth client never calls it. The build must use the
// same values (they are inlined): the root `pnpm e2e` script and the CI job set them.
export const WEB_SUPABASE = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
};

// Blank every credential so a developer's .env files cannot make the run reach real services.
const NO_KEYS = {
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  ANTHROPIC_API_KEY: "",
  GEMINI_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_MAPS_API_KEY: "",
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  TELEGRAM_BOT_TOKEN: "",
  ELEVENLABS_API_KEY: "",
};

export default defineConfig({
  testDir: "tests",
  // One API process holds the state, so tests run one at a time in a fixed order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    // Chromium at the stage iPhone's size.
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: WEB_URL,
    timezoneId: "Europe/Athens",
    locale: "en-GB",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node --import tsx src/index.ts",
      cwd: "../apps/api",
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...NO_KEYS,
        PORT: String(API_PORT),
        API_KEY: "dev-key",
        DEMO_WEEK: "on",
        // The presenter link (#343), the same value as on the web app below and in tests/fixtures.ts.
        DEMO_PRESENTER_KEY: "e2e-presenter-key",
        E2E_TEST_AUTH: "on",
        // One test user may read the waiting list (tests/waitlist.spec.ts, WAITLIST_ADMIN).
        ADMIN_EMAILS: "0000a0a0-0000-4000-8000-00000000a0a0@e2e.michael.test",
        WEB_ORIGIN: WEB_URL,
        PUBLIC_API_URL: API_URL,
        SCHEDULER_ENABLED: "false",
        CALENDAR_SYNC_MINUTES: "0",
        // A stand in bot, so the Telegram connection can be completed by a simulated webhook
        // (tests/connections-live.spec.ts). Nothing reaches Telegram: the username is given (no
        // getMe), the webhook is never registered over http, and replies ride the webhook response.
        TELEGRAM_BOT_TOKEN: "e2e-bot-token",
        TELEGRAM_BOT_USERNAME: "michael_e2e_bot",
        TELEGRAM_WEBHOOK_SECRET: "e2e-telegram-secret",
        NODE_ENV: "test",
      },
    },
    {
      command: `pnpm exec next start --port ${WEB_PORT} --hostname localhost`,
      cwd: "../apps/web",
      url: `${WEB_URL}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...NO_KEYS,
        ...WEB_SUPABASE,
        USE_MOCKS: "false",
        API_URL,
        API_KEY: "dev-key",
        MCP_URL: "",
        DEMO_PRESENTER_KEY: "e2e-presenter-key",
        E2E_TEST_AUTH: "on",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
