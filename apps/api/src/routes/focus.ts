import { Hono } from "hono";
import { z } from "zod";
import { activeFocus, endFocus, extendFocus, startFocus } from "../focus/session";
import { HttpError, jsonBody, parse } from "../http";

// Focus now (#397): one tap turns an intention into protected time. The rules are in
// focus/session.ts; the chat tool and the MCP tool go through the same functions.
const Id = z.uuid();

/** An optional body: none, or empty, reads as {}. */
const optionalBody = async (c: Parameters<typeof jsonBody>[0]) => {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError("bad_request", "Body must be valid JSON");
  }
};

export const focus = new Hono()
  // GET /v1/focus/active  200 FocusActiveResponse (a session whose end passed is finished first)
  .get("/focus/active", async (c) => c.json(await activeFocus()))
  // POST /v1/focus/start { goal_id | goal | event_id, minutes? }  201 FocusSession; 409 one is running
  .post("/focus/start", async (c) => c.json(await startFocus(await jsonBody(c), "app"), 201))
  // POST /v1/focus/:id/extend { minutes? }  200 FocusSession (+15 by default)
  .post("/focus/:id/extend", async (c) =>
    c.json(await extendFocus(parse(Id, c.req.param("id")), await optionalBody(c))),
  )
  // POST /v1/focus/:id/end { count? }  200 FocusSession (on time, or early: count the minutes or not)
  .post("/focus/:id/end", async (c) =>
    c.json(await endFocus(parse(Id, c.req.param("id")), await optionalBody(c), "app")),
  );
