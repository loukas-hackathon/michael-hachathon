import { GoalCreate, GoalUpdate } from "@michael/shared";
import { Hono } from "hono";
import { HttpError, jsonBody, parse } from "../http";
import { store } from "../store";

export const goals = new Hono()
  .get("/goals", async (c) => c.json({ goals: await store.listGoals() }))
  .get("/goals/:id", async (c) => {
    const goal = await store.getGoal(c.req.param("id"));
    if (!goal) throw new HttpError("not_found", "Goal not found");
    return c.json(goal);
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
