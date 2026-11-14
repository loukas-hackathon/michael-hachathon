import "server-only";
import { ConnectDecisionResponse, ConnectRequest } from "@michael/shared";
import { API_URL, bearer } from "./api";

// Connecting Claude (or another MCP client) with OAuth. The API checks the request; this page
// only asks the signed in user to allow it. Always talks to the real API, also with USE_MOCKS.

/** The URL people paste into claude.ai. MCP_URL overrides it when the public API URL differs. */
export const MCP_URL = process.env.MCP_URL || `${API_URL.replace(/\/$/, "")}/mcp`;

export async function getConnectRequest(id: string): Promise<ConnectRequest | null> {
  const res = await fetch(`${API_URL}/v1/connect/requests/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${await bearer()}` },
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`GET connect request failed: ${res.status}`);
  return ConnectRequest.parse(await res.json());
}

/** Allow or refuse; returns where to send the browser next (back to Claude). */
export async function decideConnect(id: string, allow: boolean): Promise<string | null> {
  const res = await fetch(`${API_URL}/v1/connect/requests/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await bearer()}`, "content-type": "application/json" },
    body: JSON.stringify({ allow }),
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 409) return null;
  if (!res.ok) throw new Error(`POST connect decision failed: ${res.status}`);
  return ConnectDecisionResponse.parse(await res.json()).redirect_to;
}
