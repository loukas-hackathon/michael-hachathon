import "server-only";
import { Traction } from "@michael/shared";
import { authHeaders, currentCaller } from "./caller";
import { API_URL, USE_MOCKS } from "./mode";

/**
 * GET /v1/admin/traction for the signed in founder. Null for everyone else: not signed in, a demo
 * visitor, or a signed in account the API does not count as an admin (it answers 404). Throws only
 * when the API failed for an admin, so the page can say so.
 */
export async function getTraction(): Promise<Traction | null> {
  if (USE_MOCKS) return null;
  const caller = await currentCaller().catch(() => null);
  if (caller?.kind !== "session") return null;
  const res = await fetch(`${API_URL}/v1/admin/traction`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`GET /v1/admin/traction failed: ${res.status}`);
  return Traction.parse(await res.json());
}
