import { GoalBook, GoalCreate, GoalSuggestionAccept, GoalUpdate } from "@michael/shared";
import { Hono } from "hono";
import { revertExpiredGoalChanges } from "../actions/calendar";
import { bookGoalTime } from "../goals/book";
import { acceptSuggestion, currentSuggestions } from "../goals/suggestions";
import { HttpError, jsonBody, parse } from "../http";
import { store } from "../store";

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
