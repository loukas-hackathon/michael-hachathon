import { serve } from "@hono/node-server";
import { app } from "./app";
import { env } from "./env";
import { startCalendarSync } from "./integrations/scheduler";
import { registerWebhook } from "./nudges/telegram";
import { startScheduler } from "./scheduler";

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`michael api listening on http://localhost:${info.port}`);
  startScheduler();
  // With a bot token: point the Telegram bot at this API (a repeat is a no-op for Telegram).
  void registerWebhook();
});

startCalendarSync();
