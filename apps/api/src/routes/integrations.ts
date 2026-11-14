import { Hono } from "hono";
import { notImplemented } from "../http";

// GET /v1/integrations is authed; OAuth connect/callback are mounted without auth in app.ts
// because they are browser redirects.
export const integrations = new Hono().get("/integrations", notImplemented("GET /v1/integrations"));

export const oauth = new Hono()
  .get("/oauth/:provider/connect", notImplemented("OAuth connect"))
  .get("/oauth/:provider/callback", notImplemented("OAuth callback"));
