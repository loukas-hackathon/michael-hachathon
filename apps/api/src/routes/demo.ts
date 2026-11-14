import { Hono } from "hono";
import { seedDemoWeek } from "../demo/sync";
import { store } from "../store";

// The demo account's week (src/demo). Only the demo account may call it (403 otherwise), and it
// only ever touches the demo account's own generated rows.
export const demo = new Hono().post("/demo/reseed", async (c) =>
  c.json(await seedDemoWeek(store, { overwriteGoals: true })),
);
