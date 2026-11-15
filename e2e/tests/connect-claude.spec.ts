import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { API_KEY, API_URL, expect, PRESENTER_KEY, test } from "./fixtures";

// The claude.ai custom connector, step by step as claude.ai runs it against production (#121, #321):
// an unauthenticated MCP call answers 401 with the resource metadata pointer; claude.ai reads the
// protected resource and authorisation server metadata, registers itself with its own callback,
// and opens /oauth/authorize with PKCE; signed out, Michael asks the person to sign in and keeps
// the way back to the consent page; one tap on Allow returns a code to claude.ai, which swaps it
// for a token and calls initialize and tools/list. Google is not reachable here, so the test user
// cookie stands in for the Google round trip. Demo visitors cannot connect (#197); the presenter,
// who opened the presenter link once in this browser, taps Allow like anyone else (#343).

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

type Flow = { clientId: string; verifier: string; authorizeUrl: string };

/** What claude.ai does before the browser opens: discovery, registration, the authorise URL. */
async function claudeStarts(): Promise<Flow> {
  const unauth = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "claude-ai", version: "0.1" },
      },
    }),
  });
  expect(unauth.status).toBe(401);
  const pointer = /resource_metadata="([^"]+)"/.exec(unauth.headers.get("www-authenticate") ?? "")?.[1];
  expect(pointer).toBe(`${API_URL}/.well-known/oauth-protected-resource/mcp`);

  const pr = (await (await fetch(pointer ?? "")).json()) as {
    resource: string;
    authorization_servers: string[];
  };
  expect(pr.resource).toBe(`${API_URL}/mcp`);
  const as = (await (
    await fetch(`${pr.authorization_servers[0]}/.well-known/oauth-authorization-server`)
  ).json()) as {
    authorization_endpoint: string;
    registration_endpoint: string;
    token_endpoint: string;
  };
  expect(as.token_endpoint).toBe(`${API_URL}/oauth/token`);

  const reg = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [CLAUDE_CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(reg.status).toBe(201);
  const { client_id } = (await reg.json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(as.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "s1",
    scope: "timeline goals recommendations score write_events",
    resource: pr.resource,
  }))
    authorize.searchParams.set(k, v);
  return { clientId: client_id, verifier, authorizeUrl: authorize.toString() };
}

/**
 * The consent form's answer is a 303 to claude.ai's callback. A browser cannot be routed on a
 * redirect, so the form post is fetched here without following it, its Location kept, and the
 * page shown that URL instead: nothing leaves the machine.
 */
async function stubClaudeCallback(page: Page) {
  await page.route("**/connect/decide", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers().location ?? "";
    if (response.status() !== 303 || !location.startsWith(`${CLAUDE_CALLBACK}?`)) {
      return route.fulfill({ response });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<title>Claude</title><output id="callback">${location.replaceAll("&", "&amp;")}</output>`,
    });
  });
}

/** Signed out: the consent page sends the person to sign in and remembers where they were. */
async function signedOutToLogin(page: Page, context: BrowserContext, flow: Flow): Promise<string> {
  await page.goto(flow.authorizeUrl);
  await expect(page).toHaveURL(/\/login\?next=%2Fconnect%3Frequest%3D/);
  const cookie = (await context.cookies()).find((c) => c.name === "michael_next")?.value ?? "";
  const next = decodeURIComponent(cookie);
  expect(next).toMatch(/^\/connect\?request=[0-9a-f-]{36}$/);
  return next;
}

/** Allow, back to claude.ai with a code, then what claude.ai's server does with it. */
async function allowAndFinish(page: Page, flow: Flow) {
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page).toHaveTitle("Claude");
  await claudeFinishes((await page.locator("#callback").textContent()) ?? "", flow);
}

/** claude.ai's server side: the callback's code for a token, then initialize and tools/list. */
async function claudeFinishes(callback: string, flow: Flow) {
  const back = new URL(callback);
  expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_CALLBACK);
  expect(back.searchParams.get("state")).toBe("s1");
  expect(back.searchParams.get("iss")).toBe(API_URL);
  const code = back.searchParams.get("code") ?? "";
  expect(code).not.toBe("");

  const tokenRes = await fetch(`${API_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: flow.verifier,
      client_id: flow.clientId,
      redirect_uri: CLAUDE_CALLBACK,
      resource: `${API_URL}/mcp`,
    }).toString(),
  });
  expect(tokenRes.status).toBe(200);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const call = (body: unknown) =>
    fetch(`${API_URL}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${access_token}` },
      body: JSON.stringify(body),
    });
  const init = await call({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-ai", version: "0.1" },
    },
  });
  expect(init.status).toBe(200);
  expect(await init.text()).toContain('"name":"michael"');
  const tools = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  expect(tools.status).toBe(200);
  expect(await tools.text()).toContain("get_timeline");
}

test("connect Claude as claude.ai does: discovery, sign in round trip, Allow, token, MCP", async ({
  page,
  context,
  baseURL,
}) => {
  await stubClaudeCallback(page);
  const flow = await claudeStarts();
  const next = await signedOutToLogin(page, context, flow);

  // Signed in (Google's stand in), /auth/callback sends them back to the cookie's path.
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  await page.goto(next);
  await expect(
    page.getByRole("heading", { name: "Allow Claude to read and change your day?" }),
  ).toBeVisible();

  await allowAndFinish(page, flow);

  // Claude now shows on Agents, approved by this user.
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "What they can do" })).toBeVisible();
  await expect(page.getByText("Claude").first()).toBeVisible();
});

test("a demo visitor cannot connect; the presenter link makes it one tap", async ({ page, context }) => {
  await stubClaudeCallback(page);
  const flow = await claudeStarts();
  await signedOutToLogin(page, context, flow);

  // "See the demo week" keeps the way back to the consent page, which refuses: connecting would
  // give the agent full write on the shared demo account (#197).
  await page.getByRole("link", { name: "See the demo week" }).click();
  await expect(page).toHaveURL(/\/connect\?request=/);
  const consent = new URL(page.url());
  const consentPath = `${consent.pathname}${consent.search}`;
  await expect(page.getByRole("heading", { name: "This is the demo week." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
  await expect(page.getByText(/Presenting\? Open your presenter link/)).toBeVisible();

  // A wrong key is just a visitor: still no Allow, and no presenter cookie.
  await page.goto(`/auth/presenter?key=not-the-key&next=${encodeURIComponent(consentPath)}`);
  await expect(page).toHaveURL(/\/connect\?request=/);
  await expect(page.getByRole("heading", { name: "This is the demo week." })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === "michael_presenter")).toBe(false);
  // Nor can a visitor post the form by hand: back to the page that says why.
  const forged = await page.request.post("/connect/decide", {
    form: { request: consent.searchParams.get("request") ?? "", allow: "yes" },
    maxRedirects: 0,
  });
  expect(forged.status()).toBe(303);
  expect(forged.headers().location).toContain("/connect?request=");
  // Nor fake the presenter cookie: it is signed with the key.
  await context.addCookies([
    {
      name: "michael_presenter",
      value: `${Math.floor(Date.now() / 1000) + 3600}.forged`,
      url: consent.origin,
    },
  ]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);

  // The presenter link, opened once on the presenting laptop, then the one tap.
  await page.goto(`/auth/presenter?key=${PRESENTER_KEY}&next=${encodeURIComponent(consentPath)}`);
  await expect(page).toHaveURL(/\/connect\?request=/);
  await expect(
    page.getByRole("heading", { name: "Allow Claude to read and change your day?" }),
  ).toBeVisible();
  await expect(page.getByText("Signed in as the demo week (presenter).")).toBeVisible();
  const presenter = (await context.cookies()).find((c) => c.name === "michael_presenter");
  expect(presenter?.httpOnly).toBe(true);
  await allowAndFinish(page, flow);

  // The demo account is shared by the whole suite: switch Claude off again (and drop the presenter
  // cookie), so the other tests still see Agents with nothing connected.
  await context.clearCookies({ name: "michael_presenter" });
  const auth = { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" };
  const { agents } = (await (await fetch(`${API_URL}/v1/agents`, { headers: auth })).json()) as {
    agents: { id: string; name: string; status: string }[];
  };
  expect(agents.some((a) => a.name === "Claude" && a.status === "approved")).toBe(true);
  for (const a of agents.filter((x) => x.name === "Claude" && x.status === "approved")) {
    const res = await fetch(`${API_URL}/v1/agents/${a.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ status: "revoked" }),
    });
    expect(res.status).toBe(200);
  }
});

test("an expired or unknown request says to start again from Claude", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  await page.goto(`/connect?request=${randomUUID()}`);
  await expect(page.getByRole("heading", { name: "This link has expired." })).toBeVisible();
});

test("You > Claude is one link and one line", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  await page.goto("/you/connections/claude");
  await expect(page.getByText("Your Michael link")).toBeVisible();
  await expect(page.getByText(`${API_URL}/mcp`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(1);
  await expect(page.getByText(/add a custom connector, paste it and tap Allow/)).toBeVisible();
});
