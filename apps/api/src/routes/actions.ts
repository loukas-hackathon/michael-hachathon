import { Hono } from "hono";
import { z } from "zod";
import { executeRecommendation, undoRecommendation } from "../actions/calendar";
import { parse } from "../http";

const Id = z.uuid();

// Carry out a recommendation's action on the user's own calendar, and take it back.
export const actions = new Hono()
  .post("/recommendations/:id/execute", async (c) =>
    c.json(await executeRecommendation(parse(Id, c.req.param("id")))),
  )
  .post("/recommendations/:id/undo", async (c) =>
    c.json(await undoRecommendation(parse(Id, c.req.param("id")))),
  );
