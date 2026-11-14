import { Hono } from "hono";
import { notImplemented } from "../http";

// Routes decided in the Build Hub, contract defined in docs/api.md, implemented by their issues.
export const product = new Hono()
  // recommendation actions
  .post("/recommendations/:id/execute", notImplemented("POST /v1/recommendations/:id/execute"))
  .post("/recommendations/:id/undo", notImplemented("POST /v1/recommendations/:id/undo"))
  // Michael for agents
  .get("/agents", notImplemented("GET /v1/agents"))
  .patch("/agents/:id", notImplemented("PATCH /v1/agents/:id"))
  .get("/agents/queries", notImplemented("GET /v1/agents/queries"))
  // nudges and score
  .get("/nudges", notImplemented("GET /v1/nudges"))
  .get("/score", notImplemented("GET /v1/score"));
