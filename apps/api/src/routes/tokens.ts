import { PersonalTokenCreate, type PersonalTokenCreated } from "@michael/shared";
import { Hono } from "hono";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";
import { createPersonalToken, listPersonalTokens, revokePersonalToken } from "../tokens";

// Personal tokens for the signed-in user: one per device or tool (Mac collector, Health Auto
// Export, Claude). The secret is returned once, with a ready-to-paste Claude connector URL.
export const tokens = new Hono()
  .get("/tokens", async (c) => c.json({ tokens: await listPersonalTokens() }))
  .post("/tokens", async (c) => {
    const { name } = parse(PersonalTokenCreate, await jsonBody(c));
    const { token, secret } = await createPersonalToken(name);
    const body: PersonalTokenCreated = {
      token,
      secret,
      mcp_url: `${env.PUBLIC_API_URL}/mcp?key=${secret}`,
    };
    return c.json(body, 201);
  })
  .delete("/tokens/:id", async (c) => {
    if (!(await revokePersonalToken(c.req.param("id")))) throw new HttpError("not_found", "Token not found");
    return c.body(null, 204);
  });
