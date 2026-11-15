// Loaded before every test file (`pnpm test` passes it with --import), so tests are hermetic:
// memory store, no demo week, no background jobs, and no real keys from the developer's shell,
// which would send requests to Supabase, Anthropic, Google or push services.
// Tests that need a setting (say GOOGLE_CLIENT_ID) set a fake value themselves before importing the app.
const unset = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_MAPS_API_KEY",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "API_KEY",
  "PUBLIC_WEB_URL",
  "WEB_URL",
  "RAILWAY_GIT_COMMIT_SHA",
];
for (const key of unset) delete process.env[key];

Object.assign(process.env, {
  NODE_ENV: "test",
  DEMO_WEEK: "off",
  SCHEDULER_ENABLED: "false",
  CALENDAR_SYNC_MINUTES: "0",
  // A fixed presenter key, so isolation.test.ts can prove who may and may not use it.
  DEMO_PRESENTER_KEY: "test-presenter-key",
});
