import { Hono } from "hono";
import { isAdmin } from "../admin";
import { errorResponse } from "../http";
import { getTraction } from "../traction";

// Admin routes (admin.ts): the founders only. Everyone else gets the same 404 as a route that does
// not exist, so nobody learns they are here.
export const admin = new Hono().get("/admin/traction", async (c) => {
  if (!(await isAdmin())) return errorResponse(c, "not_found", `No route for ${c.req.method} ${c.req.path}`);
  c.header("Cache-Control", "private, no-store");
  return c.json(await getTraction());
});
