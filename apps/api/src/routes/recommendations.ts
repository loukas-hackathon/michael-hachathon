import { RecommendationStatus, RecommendationStatusUpdate } from "@michael/shared";
import { Hono } from "hono";
import { HttpError, jsonBody, parse } from "../http";
import { store } from "../store";

export const recommendations = new Hono()
  .get("/recommendations", async (c) => {
    const raw = c.req.query("status");
    const status = raw ? parse(RecommendationStatus, raw) : undefined;
    return c.json({ recommendations: await store.listRecommendations({ status }) });
  })
  .patch("/recommendations/:id", async (c) => {
    const { status } = parse(RecommendationStatusUpdate, await jsonBody(c));
    const rec = await store.updateRecommendationStatus(c.req.param("id"), status);
    if (!rec) throw new HttpError("not_found", "Recommendation not found");
    return c.json(rec);
  });
