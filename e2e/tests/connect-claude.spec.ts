import { createHash, randomBytes, randomUUID } from "node:crypto";
import { API_URL, expect, test } from "./fixtures";

// The claude.ai custom connector, as a browser lives it (#121): Claude registers and sends the
// person to /oauth/authorize; signed out, Michael asks them to sign in and keeps the way back to
// the consent page; one tap on Allow returns a code to Claude, and the token reads their own day.
// Google is not reachable here, so the test user cookie stands in for the Google round trip.

// Any loopback page that answers stands in for claude.ai's callback (redirect targets can't be routed).
const CALLBACK = `${API_URL}/health`;

test("connect Claude with the plain MCP URL: sign in, Allow, own data", async ({
  page,
  context,
  baseURL,
}) => {
  const reg = await fetch(`${API_URL}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [CALLBACK], client_name: "Claude" }),
  });
  expect(reg.status).toBe(201);
  const { client_id } = (await reg.json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(`${API_URL}/oauth/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "s1",
    resource: `${API_URL}/mcp`,
  }))
    authorize.searchParams.set(k, v);

  // Signed out: the consent page sends the person to sign in, and remembers where they were.
  await page.goto(authorize.toString());
  await expect(page).toHaveURL(/\/login\?next=%2Fconnect%3Frequest%3D/);
  const cookie = (await context.cookies()).find((c) => c.name === "michael_next")?.value ?? "";
  const next = decodeURIComponent(cookie);
  expect(next).toMatch(/^\/connect\?request=[0-9a-f-]{36}$/);

  // Signed in (Google's stand in), /auth/callback sends them back to the cookie's path.
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  await page.goto(next);
  await expect(
    page.getByRole("heading", { name: "Allow Claude to read and change your day?" }),
  ).toBeVisible();

  // Allow goes back to Claude with a one time code.
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page).toHaveURL((u) => u.toString().startsWith(`${CALLBACK}?`));
  const back = new URL(page.url());
  expect(back.searchParams.get("state")).toBe("s1");
  const code = back.searchParams.get("code") ?? "";
  expect(code).not.toBe("");

  const tokenRes = await fetch(`${API_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id,
      redirect_uri: CALLBACK,
    }).toString(),
  });
  expect(tokenRes.status).toBe(200);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const mcp = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access_token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(mcp.status).toBe(200);
  expect(await mcp.text()).toContain("get_timeline");

  // Claude now shows on Agents, approved by this user.
  await page.goto("/agents");
  await expect(page.getByText("Claude").first()).toBeVisible();
});

test("You > Claude is one link and one line", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  await page.goto("/you/connections/claude");
  await expect(page.getByText(`${API_URL}/mcp`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(1);
  await expect(page.getByText(/add a custom connector, paste it and tap Allow/)).toBeVisible();
});
