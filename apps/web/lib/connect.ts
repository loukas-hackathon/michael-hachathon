import "server-only";
import { ConnectDecisionResponse, ConnectRequest } from "@michael/shared";
import { API_URL } from "./api";
import { authHeaders } from "./caller";
import { type ConnectOutcome, connectOutcome } from "./connect-outcome";

// Connecting Claude (or another MCP client) with OAuth. The API checks the request; this page
// only asks the signed in user to allow it. Always talks to the real API, also with USE_MOCKS.

/** The URL people paste into claude.ai. MCP_URL overrides it when the public API URL differs. */
export const MCP_URL = process.env.MCP_URL || `${API_URL.replace(/\/$/, "")}/mcp`;

export type ConnectRead = { kind: "ok"; request: ConnectRequest } | { kind: Exclude<ConnectOutcome, "ok"> };
export type ConnectDecided = { kind: "ok"; redirectTo: string } | { kind: Exclude<ConnectOutcome, "ok"> };

/** The caller's headers, or null when nobody is signed in (the session ended on the way). */
async function callerHeaders(): Promise<Record<string, string> | null> {
  try {
    return await authHeaders();
  } catch {
    return null;
  }
}

export async function getConnectRequest(id: string): Promise<ConnectRead> {
  const headers = await callerHeaders();
  if (!headers) return { kind: "signed_out" };
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/connect/requests/${encodeURIComponent(id)}`, {
      headers,
      cache: "no-store",
    });
  } catch (err) {
    console.error(`[connect] GET request ${id}: ${(err as Error).message}`);
    return { kind: "failed" };
  }
  const kind = connectOutcome(res.status);
  if (kind !== "ok") {
    if (kind === "failed") console.error(`[connect] GET request ${id}: ${res.status} ${await res.text()}`);
    return { kind };
  }
  return { kind, request: ConnectRequest.parse(await res.json()) };
}

/** Allow or refuse; on success, where to send the browser next (back to Claude). */
export async function decideConnect(id: string, allow: boolean): Promise<ConnectDecided> {
  const headers = await callerHeaders();
  if (!headers) return { kind: "signed_out" };
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/connect/requests/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ allow }),
      cache: "no-store",
    });
  } catch (err) {
    console.error(`[connect] POST decision ${id}: ${(err as Error).message}`);
    return { kind: "failed" };
  }
  const kind = connectOutcome(res.status);
  if (kind !== "ok") {
    if (kind === "failed") console.error(`[connect] POST decision ${id}: ${res.status} ${await res.text()}`);
    return { kind };
  }
  return { kind, redirectTo: ConnectDecisionResponse.parse(await res.json()).redirect_to };
}
