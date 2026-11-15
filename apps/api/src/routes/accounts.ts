import { AccountCreate, type AccountCreated } from "@michael/shared";
import { Hono } from "hono";
import { createConfirmedUser } from "../auth";
import { currentAuthMethod } from "../context";
import { HttpError, jsonBody, parse } from "../http";

// POST /v1/accounts (#475): an email and password account, created already confirmed. Only the web
// app's server may call it (the API key, no visitor), so nobody can mint accounts from outside.
// admin.createUser skips Supabase's own sign up rate limits, so the API keeps its own: at most
// MAX_PER_HOUR new accounts an hour across everyone (one replica), enough for the demo and a wall
// against anyone scripting the sign in page.
const MAX_PER_HOUR = 30;
const recent: number[] = [];
const allowAnother = (now = Date.now()) => {
  while ((recent[0] ?? now) <= now - 3_600_000) recent.shift();
  if (recent.length >= MAX_PER_HOUR) return false;
  recent.push(now);
  return true;
};

export const accounts = new Hono().post("/accounts", async (c) => {
  if (currentAuthMethod() !== "api_key") {
    throw new HttpError("forbidden", "Accounts are created from the sign in page");
  }
  const { email, password } = parse(AccountCreate, await jsonBody(c));
  if (!allowAnother())
    throw new HttpError("rate_limited", "Too many new accounts this hour. Try again later");
  const result = await createConfirmedUser(email.trim().toLowerCase(), password);
  if (result === "exists") throw new HttpError("conflict", "An account with this email already exists");
  if (result === "off") throw new HttpError("unavailable", "Sign in is not configured on this server");
  const body: AccountCreated = { created: true };
  return c.json(body, 201);
});
