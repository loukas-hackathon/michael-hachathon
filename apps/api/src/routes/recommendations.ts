import { RecommendationStatus, RecommendationStatusUpdate } from "@michael/shared";
import { Hono } from "hono";
import { HttpError, jsonBody, parse } from "../http";
import { store } from "../store";

export const recommendations = new Hono()
  .get("/recommendations", async (c) => {
    const raw = c.req.query("status");
    const status = raw ? parse(RecommendationStatus, raw) : undefined;
    // The user's own Timeline edits (#271) are kept for Undo only; they are not advice.
    const all = await store.listRecommendations({ status });
    return c.json({ recommendations: all.filter((r) => r.source !== "user") });
  })
  .patch("/recommendations/:id", async (c) => {
    const { status } = parse(RecommendationStatusUpdate, await jsonBody(c));
    const rec = await store.updateRecommendationStatus(c.req.param("id"), status);
    if (!rec) throw new HttpError("not_found", "Recommendation not found");
    return c.json(rec);
  });
