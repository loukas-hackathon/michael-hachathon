import "server-only";
import { WaitlistAdmin, WaitlistCode, WaitlistStanding } from "@michael/shared";
import { authHeaders } from "./caller";
import { API_URL } from "./mode";

// The waiting list (docs/api.md, Waiting list). Standings are public: no auth header. The full
// list is for admins only (ADMIN_EMAILS on the API); everyone else gets a 404 from the API.
// Always the real API, also with USE_MOCKS.

/** Where one code stands, or null when no one has it. Throws when the API cannot be reached. */
export async function getStanding(code: string): Promise<WaitlistStanding | null> {
  if (!WaitlistCode.safeParse(code).success) return null;
  const res = await fetch(`${API_URL}/v1/waitlist/${encodeURIComponent(code)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /v1/waitlist/:code failed: ${res.status}`);
  return WaitlistStanding.parse(await res.json());
}

/** The full list and its numbers for an admin; null for everyone else (signed out included). */
export async function getWaitlistAdmin(): Promise<WaitlistAdmin | null> {
  let headers: Record<string, string>;
  try {
    headers = await authHeaders();
  } catch {
    return null;
  }
  // Only a signed in session can be an admin; the demo visitor and the local key never are.
  if (!headers.authorization || headers["x-michael-demo-visitor"]) return null;
  const res = await fetch(`${API_URL}/v1/waitlist`, { headers, cache: "no-store" });
  if (res.status === 404 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`GET /v1/waitlist failed: ${res.status}`);
  return WaitlistAdmin.parse(await res.json());
}
