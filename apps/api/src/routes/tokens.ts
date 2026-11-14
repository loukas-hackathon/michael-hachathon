import { PersonalTokenCreate, type PersonalTokenCreated } from "@michael/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { currentAuthMethod } from "../context";
import { HttpError, jsonBody, parse } from "../http";
import { createPersonalToken, listPersonalTokens, revokePersonalToken } from "../tokens";

// Only a person signed in to the app manages device keys, so a leaked key (or the demo API key)
// can never mint, list or revoke keys.
const requireSession: MiddlewareHandler = async (_c, next) => {
  if (currentAuthMethod() !== "session") {
    throw new HttpError("forbidden", "Sign in to the app to manage your device keys");
  }
  await next();
};

// Device keys: one per device or tool that sends data (Mac collector, Health Auto Export).
// The secret is returned once, at creation.
export const tokens = new Hono()
  .use("/tokens", requireSession)
  .use("/tokens/*", requireSession)
  .get("/tokens", async (c) => c.json({ tokens: await listPersonalTokens() }))
  .post("/tokens", async (c) => {
    const { name } = parse(PersonalTokenCreate, await jsonBody(c));
    const { token, secret } = await createPersonalToken(name);
    const body: PersonalTokenCreated = { token, secret };
    return c.json(body, 201);
  })
  .delete("/tokens/:id", async (c) => {
    if (!(await revokePersonalToken(c.req.param("id")))) throw new HttpError("not_found", "Key not found");
    return c.body(null, 204);
  });
