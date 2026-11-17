import { Hono } from "hono";
import { activeDnd, noteMac } from "../actions/dnd";
import { activeFocusGuards } from "../actions/focus-guard";
import { suggestAppGuard } from "../actions/mac-apps";

// Focus guards (#41): block_mac_app recommendations that were carried out. The Mac collector polls
// /focus-guards/active with its device key (the one read a device key may make, see auth.ts).
export const focusGuards = new Hono()
  // `?dnd=ready|missing`: the Mac also says whether it has the Michael Focus shortcut, and reads
  // the Do Not Disturb to switch on (#447). It stands whatever the privacy switch says: the user
  // asked for it, and going off the record must not ring the phone again.
  .get("/focus-guards/active", async (c) => {
    const shortcut = c.req.query("dnd");
    if (shortcut === "ready" || shortcut === "missing") noteMac(shortcut === "ready");
    const [guards, on] = await Promise.all([activeFocusGuards(), activeDnd()]);
    return c.json({ ...guards, dnd: on });
  })
  // Propose muting the week's worst Mac offender during today's next work block (or null).
  .post("/focus-guards/suggest", async (c) => {
    const recommendation = await suggestAppGuard();
    return c.json({ recommendation }, recommendation ? 201 : 200);
  });
