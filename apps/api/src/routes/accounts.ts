import { AccountCreate, type AccountCreated } from "@michael/shared";
import { Hono } from "hono";
import { createConfirmedUser } from "../auth";
import { currentAuthMethod } from "../context";
import { HttpError, jsonBody, parse } from "../http";

// admin.createUser skips Supabase's own sign up rate limits, so the API keeps one backstop (one
// replica, in memory): at most TOTAL new accounts an hour across everyone. No per address limit: a
// whole venue shares one wifi address. Only accounts really created count. Sign in is never limited.
const HOUR = 3_600_000;
const TOTAL = 500;
const created: number[] = [];

const prune = (now: number) => {
  while ((created[0] ?? now) <= now - HOUR) created.shift();
};

// POST /v1/accounts (#475): an email and password account, created already confirmed. Only the web
// app's server may call it (the API key, no visitor), so nobody can mint accounts from outside.
export const accounts = new Hono().post("/accounts", async (c) => {
  if (currentAuthMethod() !== "api_key") {
    throw new HttpError("forbidden", "Accounts are created from the sign in page");
  }
  const { email, password } = parse(AccountCreate, await jsonBody(c));
  const now = Date.now();
  prune(now);
  if (created.length >= TOTAL)
    throw new HttpError("rate_limited", "Too many new accounts this hour. Try again later");
  // Reserve the slot before waiting on Supabase, so parallel requests cannot all pass the check;
  // give it back when no account was made.
  created.push(now);
  const result = await createConfirmedUser(email.trim().toLowerCase(), password).catch((err) => {
    created.splice(created.indexOf(now), 1);
    throw err;
  });
  if (result !== "created") created.splice(created.indexOf(now), 1);
  if (result === "exists") throw new HttpError("conflict", "An account with this email already exists");
  if (result === "off") throw new HttpError("unavailable", "Sign in is not configured on this server");
  const body: AccountCreated = { created: true };
  return c.json(body, 201);
});
