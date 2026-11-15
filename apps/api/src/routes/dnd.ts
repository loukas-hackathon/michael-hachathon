import { DndStartInput } from "@michael/shared";
import { Hono } from "hono";
import { z } from "zod";
import { dndOffer, startDnd, startDndForNudge } from "../actions/dnd-ask";
import { jsonBody, parse } from "../http";

// Do Not Disturb, asked then done (#447). The hand over page (apps/web/app/dnd) reads the offer
// and makes the tap; ending it is the recommendation's own undo (POST /v1/recommendations/:id/undo).
export const dnd = new Hono()
  // GET /v1/dnd?nudge=<id>: the one on now, what the nudge offers, and whether a Mac can do it.
  .get("/dnd", async (c) => c.json(await dndOffer(parse(z.uuid().optional(), c.req.query("nudge")))))
  // POST /v1/dnd { nudge_id } or { until }: the tap.
  .post("/dnd", async (c) => {
    const input = parse(DndStartInput, await jsonBody(c));
    const on = input.nudge_id
      ? await startDndForNudge(input.nudge_id)
      : await startDnd({ until: input.until as string, requested_by: "the app" });
    return c.json(on, 201);
  });
