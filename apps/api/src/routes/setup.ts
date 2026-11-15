import {
  SetupTokenCreate,
  type SetupTokenCreated,
  SetupTokenExchange,
  type SetupTokenExchanged,
} from "@michael/shared";
import { Hono } from "hono";
import { currentAuthMethod } from "../context";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";
import { publicBase, publicWebUrl } from "../public-url";
import { macInstallCommand, macInstallScript } from "../setup/mac-script";
import { createSetupToken, exchangeSetupToken } from "../setup-tokens";

// One tap setup (#120). The signed-in person mints a setup token for one connection; the device
// (the Mac installer, the iPhone setup page) swaps it once for an ingest only device key.

// The web app calls the API server to server, so the request's own host may be an internal one:
// prefer the configured public URL unless it is the local default.
const apiBase = (c: Parameters<typeof publicBase>[0]) =>
  /localhost|127\.0\.0\.1/.test(env.PUBLIC_API_URL) ? publicBase(c) : env.PUBLIC_API_URL.replace(/\/$/, "");

// POST /v1/setup-tokens, behind auth (mounted in v1). Only a signed-in session, like /v1/tokens.
export const setupTokens = new Hono().post("/setup-tokens", async (c) => {
  if (currentAuthMethod() !== "session") {
    throw new HttpError("forbidden", "Sign in to the app to connect your devices");
  }
  const { connection } = parse(SetupTokenCreate, await jsonBody(c));
  const { token, expires_at } = await createSetupToken(connection);
  const api = apiBase(c);
  const body: SetupTokenCreated = {
    token,
    connection,
    expires_at,
    // The token rides in the fragment, which browsers never send to a server, so it stays out of logs.
    setup_url: `${publicWebUrl()}/setup/${connection}#${token}`,
    install_command: connection === "mac" ? macInstallCommand(api, token) : null,
  };
  return c.json(body, 201);
});

// Public on purpose (mounted before the auth middleware): the setup token is the credential.
export const setupPublic = new Hono()
  .post("/setup-tokens/exchange", async (c) => {
    const { token } = parse(SetupTokenExchange, await jsonBody(c));
    const { connection, secret } = await exchangeSetupToken(token);
    const body: SetupTokenExchanged = { connection, secret, api_url: apiBase(c) };
    c.header("cache-control", "no-store");
    return c.json(body);
  })
  // The installer itself holds no secret, so anyone may read it before running it.
  .get("/setup/mac.sh", (c) => {
    const script = macInstallScript({
      apiBase: publicBase(c),
      repo: env.COLLECTOR_REPO,
      ref: env.COLLECTOR_REF,
    });
    return c.body(script, 200, { "content-type": "text/x-shellscript; charset=utf-8" });
  });
