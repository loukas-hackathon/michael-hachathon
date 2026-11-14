import { Hono } from "hono";
import { activeFocusGuards } from "../actions/focus-guard";
import { suggestAppGuard } from "../actions/mac-apps";

// Focus guards (#41): block_mac_app recommendations that were carried out. The Mac collector polls
// /focus-guards/active with its device key (the one read a device key may make, see auth.ts).
export const focusGuards = new Hono()
  .get("/focus-guards/active", async (c) => c.json(await activeFocusGuards()))
  // Propose muting the week's worst Mac offender during today's next work block (or null).
  .post("/focus-guards/suggest", async (c) => {
    const recommendation = await suggestAppGuard();
    return c.json({ recommendation }, recommendation ? 201 : 200);
  });
