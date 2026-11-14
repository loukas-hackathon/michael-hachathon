import { Hono } from "hono";
import { notImplemented } from "../http";

// Routes decided in the Build Hub, contract defined in docs/api.md, implemented by their issues.
export const product = new Hono()
  // privacy
  .get("/privacy", notImplemented("GET /v1/privacy"))
  .put("/privacy/off-the-record", notImplemented("PUT /v1/privacy/off-the-record"))
  .patch("/privacy/sources/:source", notImplemented("PATCH /v1/privacy/sources/:source"))
  // recommendation actions
  .post("/recommendations/:id/execute", notImplemented("POST /v1/recommendations/:id/execute"))
  .post("/recommendations/:id/undo", notImplemented("POST /v1/recommendations/:id/undo"))
  // Michael for agents
  .get("/agents", notImplemented("GET /v1/agents"))
  .patch("/agents/:id", notImplemented("PATCH /v1/agents/:id"))
  .get("/agents/queries", notImplemented("GET /v1/agents/queries"))
  // nudges (the score lives in routes/score.ts)
  .get("/nudges", notImplemented("GET /v1/nudges"));
