import { AccountCreate, type AccountCreated } from "@michael/shared";
import { Hono } from "hono";
import { createConfirmedUser } from "../auth";
import { currentAuthMethod } from "../context";
import { HttpError, jsonBody, parse } from "../http";

/** The visitor's IP, set by the web server (trusted: only the API key reaches this route). */
export const CLIENT_IP_HEADER = "x-michael-client-ip";

// admin.createUser skips Supabase's own sign up rate limits, so the API keeps its own (one
// replica, in memory): at most PER_IP accounts an hour from one address, and TOTAL across everyone
// as a backstop. Only accounts really created count, so failed tries use up nothing.
const HOUR = 3_600_000;
const PER_IP = 5;
const TOTAL = 60;
const created: { at: number; ip: string }[] = [];

const prune = (now: number) => {
  while ((created[0]?.at ?? now) <= now - HOUR) created.shift();
};
const full = (ip: string, now: number) =>
  created.length >= TOTAL || created.filter((c) => c.ip === ip).length >= PER_IP;

// POST /v1/accounts (#475): an email and password account, created already confirmed. Only the web
// app's server may call it (the API key, no visitor), so nobody can mint accounts from outside.
export const accounts = new Hono().post("/accounts", async (c) => {
  if (currentAuthMethod() !== "api_key") {
    throw new HttpError("forbidden", "Accounts are created from the sign in page");
  }
  const { email, password } = parse(AccountCreate, await jsonBody(c));
  const ip = c.req.header(CLIENT_IP_HEADER)?.trim().slice(0, 64) || "unknown";
  const now = Date.now();
  prune(now);
  if (full(ip, now)) throw new HttpError("rate_limited", "Too many new accounts this hour. Try again later");
  const result = await createConfirmedUser(email.trim().toLowerCase(), password);
  if (result === "exists") throw new HttpError("conflict", "An account with this email already exists");
  if (result === "off") throw new HttpError("unavailable", "Sign in is not configured on this server");
  created.push({ at: now, ip });
  const body: AccountCreated = { created: true };
  return c.json(body, 201);
});
