import type { Knowledge } from "@michael/shared";
import { Hono } from "hono";
import { knowledgeFor } from "../knowledge";

// GET /v1/me/knowledge (#379): what Michael knows about the signed-in user, in plain words.
// Read only; each item is forgotten through the route that owns it (docs/api.md).
export const knowledge = new Hono().get("/me/knowledge", async (c) => {
  const body: Knowledge = await knowledgeFor();
  return c.json(body);
});
