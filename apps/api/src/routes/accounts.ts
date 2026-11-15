import { AccountCreate, type AccountCreated } from "@michael/shared";
import { Hono } from "hono";
import { createConfirmedUser } from "../auth";
import { currentAuthMethod } from "../context";
import { HttpError, jsonBody, parse } from "../http";

// POST /v1/accounts (#475): an email and password account, created already confirmed. Only the web
// app's server may call it (the API key, no visitor), so nobody can mint accounts from outside.
export const accounts = new Hono().post("/accounts", async (c) => {
  if (currentAuthMethod() !== "api_key") {
    throw new HttpError("forbidden", "Accounts are created from the sign in page");
  }
  const { email, password } = parse(AccountCreate, await jsonBody(c));
  const result = await createConfirmedUser(email.trim().toLowerCase(), password);
  if (result === "exists") throw new HttpError("conflict", "An account with this email already exists");
  if (result === "off") throw new HttpError("unavailable", "Sign in is not configured on this server");
  const body: AccountCreated = { created: true };
  return c.json(body, 201);
});
