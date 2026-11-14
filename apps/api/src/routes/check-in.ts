import { CheckInAnswer, type CheckInAnswerResponse, type CheckInToday } from "@michael/shared";
import { Hono } from "hono";
import { z } from "zod";
import { answerCheckIn, checkInToday, deleteCheckIn } from "../checkin/service";
import { jsonBody, parse } from "../http";

const Id = z.uuid();

// The daily check in (#187): Michael's questions about the day and the user's answers.
export const checkIn = new Hono()
  // GET /v1/check-in  today's questions; opens a round when one is due
  .get("/check-in", async (c) => {
    const body: CheckInToday = await checkInToday();
    return c.json(body);
  })
  // POST /v1/check-in/:id/answer { value }  stores the answer once, with a follow up when it calls for one
  .post("/check-in/:id/answer", async (c) => {
    const { value } = parse(CheckInAnswer, await jsonBody(c));
    const body: CheckInAnswerResponse = await answerCheckIn(parse(Id, c.req.param("id")), value);
    return c.json(body, 201);
  })
  // DELETE /v1/check-in/:id  really deletes the question, its answer and its follow ups
  .delete("/check-in/:id", async (c) => {
    await deleteCheckIn(parse(Id, c.req.param("id")));
    return c.body(null, 204);
  });
