import { Hono } from "hono";
import { notImplemented } from "../http";

// Routes decided in the Build Hub, contract defined in docs/api.md, implemented by their issues.
export const product = new Hono()
  // Michael for agents
  .get("/agents", notImplemented("GET /v1/agents"))
  .patch("/agents/:id", notImplemented("PATCH /v1/agents/:id"))
  .get("/agents/queries", notImplemented("GET /v1/agents/queries"));
