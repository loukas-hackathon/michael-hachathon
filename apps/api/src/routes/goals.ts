import { GoalBook, GoalCreate, GoalSuggestionAccept, GoalUpdate, GoalWordsRequest } from "@michael/shared";
import { Hono } from "hono";
import { revertExpiredGoalChanges } from "../actions/calendar";
import { currentDemoVisitor, currentUserId } from "../context";
import { bookGoalTime } from "../goals/book";
import { goalsFromWords } from "../goals/from-words";
import { acceptSuggestion, currentSuggestions } from "../goals/suggestions";
import { HttpError, jsonBody, parse } from "../http";
import { rateLimiter } from "../rate-limit";
import { store } from "../store";

// Reading words costs a model call: a talk is a few answers, so this is plenty per caller.
export const fromWordsLimit = rateLimiter(10, 60_000);

export const goals = new Hono()
  .get("/goals", async (c) => {
    // A temporary change from chat (#188) whose end has passed goes back first. Best effort.
    // Read the goals at the same time; read again only in the rare case something went back.
    const [reverted, goals] = await Promise.all([
      revertExpiredGoalChanges().catch((err) => {
        console.error("goal change revert failed", err);
        return 0;
      }),
      store.listGoals(),
    ]);
    return c.json({ goals: reverted > 0 ? await store.listGoals() : goals });
  })
  // Goals Michael reads off the user's own calendar (#134). Before /goals/:id on purpose.
  .get("/goals/suggestions", async (c) => c.json(await currentSuggestions()))
  .post("/goals/suggestions/:id/accept", async (c) => {
    // The body is optional: no body accepts the suggestion as it is.
    const body = (await c.req.text()).trim() ? await jsonBody(c) : {};
    const edits = parse(GoalSuggestionAccept, body);
    const goal = await acceptSuggestion(c.req.param("id"), edits);
    if (!goal) throw new HttpError("not_found", "Your calendar no longer suggests that goal");
    return c.json(goal, 201);
  })
  // Goals heard in the user's own words (onboarding talk). Reads only: nothing is saved here.
  .post("/goals/from-words", async (c) => {
    const { text } = parse(GoalWordsRequest, await jsonBody(c));
    if (!fromWordsLimit.take(currentDemoVisitor() ?? currentUserId())) {
      throw new HttpError("rate_limited", "Give me a minute, then tell me again.");
    }
    return c.json(await goalsFromWords(text), 200, { "cache-control": "no-store" });
  })
  .get("/goals/:id", async (c) => {
    const goal = await store.getGoal(c.req.param("id"));
    if (!goal) throw new HttpError("not_found", "Goal not found");
    return c.json(goal);
  })
  // Book time for the goal now (#309): the first free slot this week, undoable until it starts.
  .post("/goals/:id/book", async (c) => {
    const body = (await c.req.text()).trim() ? await jsonBody(c) : {};
    const { minutes } = parse(GoalBook, body);
    return c.json(await bookGoalTime(c.req.param("id"), minutes), 201);
  })
  .post("/goals", async (c) => {
    const goal = await store.createGoal(parse(GoalCreate, await jsonBody(c)));
    return c.json(goal, 201);
  })
  .patch("/goals/:id", async (c) => {
    const goal = await store.updateGoal(c.req.param("id"), parse(GoalUpdate, await jsonBody(c)));
    if (!goal) throw new HttpError("not_found", "Goal not found");
    return c.json(goal);
  })
  .delete("/goals/:id", async (c) => {
    if (!(await store.deleteGoal(c.req.param("id")))) throw new HttpError("not_found", "Goal not found");
    return c.body(null, 204);
  });
