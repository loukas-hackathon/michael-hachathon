import { serve } from "@hono/node-server";
import { app } from "./app";
import { env } from "./env";
import { startCalendarSync } from "./integrations/scheduler";
import { startScheduler } from "./scheduler";

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`michael api listening on http://localhost:${info.port}`);
  startScheduler();
});

startCalendarSync();
