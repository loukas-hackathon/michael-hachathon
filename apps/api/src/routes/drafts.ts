import { DraftGenerateInput, DraftStatus, DraftStatusUpdate } from "@michael/shared";
import { Hono } from "hono";
import { z } from "zod";
import { generateDrafts } from "../actions/drafts";
import { HttpError, jsonBody, parse } from "../http";
import { store } from "../store";

const Id = z.uuid();

// Follow up drafts (#40): stored for the user to copy, never sent anywhere.
export const drafts = new Hono()
  // GET /v1/drafts?status=proposed  newest first
  .get("/drafts", async (c) => {
    const raw = c.req.query("status");
    const status = raw ? parse(DraftStatus, raw) : undefined;
    return c.json({ drafts: await store.listDrafts({ status }) });
  })
  // POST /v1/drafts/generate { event_id? }  drafts for what just ended (or one event)
  .post("/drafts/generate", async (c) => {
    // The body is optional: no body drafts for everything that just ended.
    const body =
      c.req.header("content-length") === "0" || !c.req.header("content-type") ? {} : await jsonBody(c);
    const { event_id } = parse(DraftGenerateInput, body ?? {});
    return c.json(await generateDrafts({ eventId: event_id }), 201);
  })
  // PATCH /v1/drafts/:id { status }  done (the user sent it) or dismissed
  .patch("/drafts/:id", async (c) => {
    const id = parse(Id, c.req.param("id"));
    const { status } = parse(DraftStatusUpdate, await jsonBody(c));
    const draft = await store.updateDraftStatus(id, status);
    if (!draft) throw new HttpError("not_found", "Draft not found");
    return c.json(draft);
  });
