import { type Knowledge, type KnowledgeItem, MemoryCreate } from "@michael/shared";
import { Hono } from "hono";
import { HttpError, jsonBody, parse } from "../http";
import { knowledgeFor } from "../knowledge";
import { remember } from "../memory";

// GET /v1/me/knowledge (#379): what Michael knows about the signed-in user, in plain words. Each
// item is forgotten through the route that owns it (docs/api.md). POST /v1/memories adds one memory
// in the user's own words, kept in the same store as the chat's remember tool.
export const knowledge = new Hono()
  .get("/me/knowledge", async (c) => {
    const body: Knowledge = await knowledgeFor();
    return c.json(body);
  })
  .post("/memories", async (c) => {
    const { text } = parse(MemoryCreate, await jsonBody(c));
    const m = await remember(text, "you");
    if (!m) throw new HttpError("conflict", "Off the record. I am keeping nothing right now.");
    const item: KnowledgeItem = {
      id: m.id,
      kind: "memory",
      text: m.text,
      answer: null,
      at: m.at,
      origin: m.from,
      active: true,
      forgettable: true,
    };
    return c.json(item, 201);
  });
