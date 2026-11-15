import { MeetingCommitmentAdd, MeetingStart, type MeetingsState } from "@michael/shared";
import { Hono } from "hono";
import { HttpError, jsonBody, parse } from "../http";
import { addCommitment, endMeeting, meetingsState, startMeeting } from "../meetings/meetings";

// Meetings mode (#400, docs/api.md): conversations are kept only while the user has started it.
export const meetings = new Hono()
  .get("/meetings/active", async (c) => {
    const body: MeetingsState = await meetingsState();
    return c.json(body);
  })
  .post("/meetings/start", async (c) => {
    // The body is optional once the user has consented.
    const text = await c.req.text();
    let raw: unknown = {};
    try {
      raw = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new HttpError("bad_request", "Body must be valid JSON");
    }
    const { consent } = parse(MeetingStart, raw ?? {});
    const body: MeetingsState = await startMeeting(consent);
    return c.json(body);
  })
  .post("/meetings/end", async (c) => {
    const body: MeetingsState = await endMeeting();
    return c.json(body);
  })
  .post("/meetings/commitments", async (c) => {
    const { text } = parse(MeetingCommitmentAdd, await jsonBody(c));
    return c.json({ item: await addCommitment(text) }, 201);
  });
