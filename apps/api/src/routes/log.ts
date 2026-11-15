import { Hono } from "hono";
import { executeRecommendation, undoRecommendation } from "../actions/calendar";
import { logTime, settleBlock } from "../actions/log";
import { HttpError, jsonBody } from "../http";
import { isLogEntry } from "../score/logged";
import { store } from "../store";

// Done time and settled blocks (#317). The rules are in actions/log.ts; the chat and the MCP tools
// go through the same functions.
export const log = new Hono()
  // POST /v1/log { goal_id | goal, minutes | start_at + end_at, note? }  201 LogTimeResponse
  .post("/log", async (c) => c.json(await logTime(await jsonBody(c), "app", executeRecommendation), 201))
  // POST /v1/log/block { event_id, did, minutes?, reason? }  201 LogTimeResponse
  .post("/log/block", async (c) =>
    c.json(await settleBlock(await jsonBody(c), "app", executeRecommendation), 201),
  )
  // DELETE /v1/log/:id  takes a logged entry back (the same as undoing its recommendation)
  .delete("/log/:id", async (c) => {
    const entry = await store.getEvent(c.req.param("id"));
    if (!entry || !isLogEntry(entry)) throw new HttpError("not_found", "No logged entry with that id");
    const recId = typeof entry.data.recommendation_id === "string" ? entry.data.recommendation_id : null;
    if (!recId) throw new HttpError("conflict", "That entry has no record to undo");
    return c.json(await undoRecommendation(recId));
  });
