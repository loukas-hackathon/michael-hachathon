import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AgentScope,
  ConnectDecision,
  type ConnectDecisionResponse,
  type ConnectRequest,
} from "@michael/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { agentsStore } from "../agents-store";
import { currentUserId } from "../context";
import { HttpError, jsonBody, parse } from "../http";
import { type OAuthGrant, type OAuthToken, oauthStore } from "../oauth-store";
import { mcpResource, publicBase, publicWebUrl } from "../public-url";

// A minimal OAuth 2.1 authorisation server for the MCP endpoint, so a user connects Michael to
// claude.ai by pasting one URL and tapping Allow (MCP authorization spec 2025-11-25):
// protected resource metadata (RFC 9728), server metadata (RFC 8414), dynamic client
// registration (RFC 7591), authorisation code with S256 PKCE, refresh token rotation.
// Signing in happens in the web app with the user's own Google session (apps/web/app/connect).

export const SCOPES = AgentScope.options;
// Time to answer the consent page, signing in on the way: a first Google sign in with the calendar
// consent screen can take longer than ten minutes on a phone, and an expired request means
// starting again from Claude.
export const GRANT_TTL_MS = 30 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_S = 24 * 3600;
const REFRESH_TTL_MS = 90 * 24 * 3600_000;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLoopback = (u: URL) => u.protocol === "http:" && LOOPBACK.has(u.hostname);

/** https anywhere, or http on a loopback address (native clients such as Claude Code). */
function validRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return !u.hash && (u.protocol === "https:" || isLoopback(u));
  } catch {
    return false;
  }
}

/** Exact match, except a loopback redirect matches on any port (RFC 8252 7.3). */
function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (!isLoopback(u)) return false;
  const portless = (x: URL) => `${x.protocol}//${x.hostname}${x.pathname}${x.search}`;
  return registered.some((r) => {
    try {
      const ru = new URL(r);
      return isLoopback(ru) && portless(ru) === portless(u);
    } catch {
      return false;
    }
  });
}

/** OAuth error body (RFC 6749 5.2), not our usual error shape: OAuth clients parse this one. */
const oauthError = (c: Context, error: string, description: string, status: 400 | 401 = 400) =>
  c.json({ error, error_description: description }, status, { "cache-control": "no-store" });

const withParams = (base: string, params: Record<string, string | null | undefined>) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
};

const parseScopes = (scope: string | undefined): AgentScope[] => {
  const asked = (scope ?? "").split(/\s+/).filter((s): s is AgentScope => (SCOPES as string[]).includes(s));
  return asked.length ? [...new Set(asked)] : [...SCOPES];
};

const sameResource = (a: string, b: string) =>
  a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();

// ---------- public endpoints (no auth), mounted at the root ----------

const protectedResource = (c: Context) =>
  c.json({
    resource: mcpResource(c),
    authorization_servers: [publicBase(c)],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Michael",
  });

const RegisterBody = z.looseObject({
  redirect_uris: z.array(z.string()).min(1),
  client_name: z.string().max(200).optional(),
});

export const oauthPublic = new Hono()
  .get("/.well-known/oauth-protected-resource", protectedResource)
  .get("/.well-known/oauth-protected-resource/mcp", protectedResource)
  .get("/.well-known/oauth-authorization-server", (c) => {
    const base = publicBase(c);
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      scopes_supported: SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
      service_documentation: "https://github.com/loukas-hackathon/michael-hachathon/blob/main/docs/api.md",
    });
  })

  // Dynamic client registration. Every client is public (PKCE, no secret).
  .post("/oauth/register", async (c) => {
    let body: z.infer<typeof RegisterBody>;
    try {
      body = RegisterBody.parse(await c.req.json());
    } catch {
      return oauthError(c, "invalid_client_metadata", "redirect_uris is required");
    }
    const bad = body.redirect_uris.find((u) => !validRedirect(u));
    if (bad) return oauthError(c, "invalid_redirect_uri", `Redirect URI must be https or loopback: ${bad}`);
    const client = {
      client_id: randomUUID(),
      client_name: body.client_name?.trim() || "An AI agent",
      redirect_uris: body.redirect_uris,
      created_at: new Date().toISOString(),
    };
    await oauthStore.createClient(client);
    return c.json(
      {
        client_id: client.client_id,
        client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  })

  // Authorisation request: checked here, then the user answers on the web consent page.
  .get("/oauth/authorize", async (c) => {
    const q = c.req.query();
    const client = q.client_id ? await oauthStore.getClient(q.client_id) : null;
    if (!client) return oauthError(c, "invalid_client", "Unknown client_id. Register first.");
    if (!q.redirect_uri || !redirectMatches(client.redirect_uris, q.redirect_uri)) {
      return oauthError(c, "invalid_request", "redirect_uri does not match a registered one");
    }
    // From here on errors go back to the client.
    const fail = (error: string, description: string) =>
      c.redirect(
        withParams(q.redirect_uri as string, {
          error,
          error_description: description,
          state: q.state,
          iss: publicBase(c),
        }),
      );
    if (q.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code");
    if (!q.code_challenge || q.code_challenge_method !== "S256") {
      return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
    }
    const resource = mcpResource(c);
    if (q.resource && !sameResource(q.resource, resource) && !sameResource(q.resource, publicBase(c))) {
      return fail("invalid_target", `Unknown resource; use ${resource}`);
    }
    const grant: OAuthGrant = {
      id: randomUUID(),
      client_id: client.client_id,
      redirect_uri: q.redirect_uri,
      state: q.state ?? null,
      code_challenge: q.code_challenge,
      scopes: parseScopes(q.scope),
      resource,
      user_id: null,
      agent_id: null,
      code_hash: null,
      expires_at: inMs(GRANT_TTL_MS),
      used_at: null,
    };
    await oauthStore.createGrant(grant);
    return c.redirect(`${publicWebUrl()}/connect?request=${grant.id}`);
  })

  .post("/oauth/token", async (c) => {
    const type = c.req.header("content-type") ?? "";
    let body: Record<string, string> = {};
    try {
      if (type.includes("application/json")) body = (await c.req.json()) as Record<string, string>;
      else body = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
    } catch {
      return oauthError(c, "invalid_request", "Send a form encoded body");
    }

    if (body.grant_type === "authorization_code") {
      const { code, code_verifier, redirect_uri, client_id, resource } = body;
      if (!code || !code_verifier)
        return oauthError(c, "invalid_request", "code and code_verifier are required");
      const grant = await oauthStore.consumeCode(sha256(code));
      if (!grant?.user_id || Date.parse(grant.expires_at) < Date.now()) {
        return oauthError(c, "invalid_grant", "Code is invalid, expired or already used");
      }
      if (client_id && client_id !== grant.client_id)
        return oauthError(c, "invalid_grant", "Code was issued to another client");
      if (redirect_uri && redirect_uri !== grant.redirect_uri)
        return oauthError(c, "invalid_grant", "redirect_uri mismatch");
      if (createHash("sha256").update(code_verifier).digest("base64url") !== grant.code_challenge) {
        return oauthError(c, "invalid_grant", "PKCE verification failed");
      }
      if (resource && !sameResource(resource, grant.resource) && !sameResource(resource, publicBase(c))) {
        return oauthError(c, "invalid_target", "resource does not match the authorisation request");
      }
      const access = secret("mcp_at");
      const refresh = secret("mcp_rt");
      const token: OAuthToken = {
        id: randomUUID(),
        client_id: grant.client_id,
        user_id: grant.user_id,
        agent_id: grant.agent_id,
        scopes: grant.scopes,
        resource: grant.resource,
        access_hash: sha256(access),
        refresh_hash: sha256(refresh),
        access_expires_at: inMs(ACCESS_TTL_S * 1000),
        refresh_expires_at: inMs(REFRESH_TTL_MS),
        revoked_at: null,
      };
      await oauthStore.createToken(token);
      return tokenResponse(c, access, refresh, token.scopes);
    }

    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) return oauthError(c, "invalid_request", "refresh_token is required");
      const access = secret("mcp_at");
      const refresh = secret("mcp_rt");
      const token = await oauthStore.rotateRefresh(sha256(body.refresh_token), {
        access_hash: sha256(access),
        refresh_hash: sha256(refresh),
        access_expires_at: inMs(ACCESS_TTL_S * 1000),
        refresh_expires_at: inMs(REFRESH_TTL_MS),
      });
      if (!token) return oauthError(c, "invalid_grant", "Refresh token is invalid, expired or revoked");
      return tokenResponse(c, access, refresh, token.scopes);
    }

    return oauthError(c, "unsupported_grant_type", "Use authorization_code or refresh_token");
  });

const tokenResponse = (c: Context, access: string, refresh: string, scopes: string[]) =>
  c.json(
    {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      scope: scopes.join(" "),
    },
    200,
    { "cache-control": "no-store", pragma: "no-cache" },
  );

// ---------- consent, for the signed in user (mounted under /v1, behind requireUser) ----------

async function pendingGrant(id: string): Promise<OAuthGrant> {
  const grant = z.uuid().safeParse(id).success ? await oauthStore.getGrant(id) : null;
  if (!grant || grant.user_id || Date.parse(grant.expires_at) < Date.now()) {
    throw new HttpError("not_found", "This connection request has expired. Start again from Claude.");
  }
  return grant;
}

export const connect = new Hono()
  .get("/connect/requests/:id", async (c) => {
    const grant = await pendingGrant(c.req.param("id"));
    const client = await oauthStore.getClient(grant.client_id);
    const body: ConnectRequest = {
      id: grant.id,
      client_name: client?.client_name ?? "An AI agent",
      redirect_host: new URL(grant.redirect_uri).host,
      scopes: grant.scopes as AgentScope[],
      expires_at: grant.expires_at,
    };
    return c.json(body);
  })
  .post("/connect/requests/:id", async (c) => {
    const { allow } = parse(ConnectDecision, await jsonBody(c));
    const grant = await pendingGrant(c.req.param("id"));
    const iss = publicBase(c);
    let redirect_to: string;
    if (allow) {
      const code = secret("mcp_code");
      // The consent tap is the one tap approval: the client becomes an approved agent.
      const client = await oauthStore.getClient(grant.client_id);
      const agent = await agentsStore.approveAgent(
        client?.client_name ?? "An AI agent",
        grant.client_id,
        grant.scopes as AgentScope[],
      );
      const approved = await oauthStore.approveGrant(grant.id, {
        userId: currentUserId(),
        agentId: agent.id,
        codeHash: sha256(code),
        expiresAt: inMs(CODE_TTL_MS),
      });
      if (!approved) throw new HttpError("conflict", "This connection request was already answered");
      redirect_to = withParams(grant.redirect_uri, { code, state: grant.state, iss });
    } else {
      await oauthStore.deleteGrant(grant.id);
      redirect_to = withParams(grant.redirect_uri, {
        error: "access_denied",
        error_description: "The user said no",
        state: grant.state,
        iss,
      });
    }
    const body: ConnectDecisionResponse = { redirect_to };
    return c.json(body);
  });

// ---------- token check, used by the auth middleware for /mcp ----------

const tokenCache = new Map<string, { token: OAuthToken; until: number }>();

/** Drops cached token checks, so a revoke takes effect on the next request. */
export const forgetTokens = () => tokenCache.clear();

/** The live token for an access token string, if it was issued for this MCP resource. */
export async function verifyAccessToken(raw: string, resource: string): Promise<OAuthToken | null> {
  if (!raw.startsWith("mcp_at_")) return null;
  const hash = sha256(raw);
  const hit = tokenCache.get(hash);
  const fresh = hit && hit.until > Date.now();
  const token = fresh ? hit.token : await oauthStore.tokenByAccessHash(hash);
  if (!token) return null;
  if (!fresh) {
    if (tokenCache.size > 1000) tokenCache.clear();
    tokenCache.set(hash, { token, until: Date.now() + 30_000 });
  }
  if (token.revoked_at || Date.parse(token.access_expires_at) < Date.now()) return null;
  if (!sameResource(token.resource, resource)) return null;
  return token;
}
