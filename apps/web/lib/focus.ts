import "server-only";
import { ApiError, FocusActiveResponse, FocusSession } from "@michael/shared";
import { authHeaders } from "./caller";
import { API_URL, USE_MOCKS } from "./mode";

// Focus now (#397): the live session, read and changed on the API. The state lives on the server,
// so any screen (and the phone coming back to the app) reattaches to the same countdown.

export type FocusResult =
  | { ok: true; session: FocusSession }
  | { ok: false; status: number; message: string };

/** GET /v1/focus/active, or null when signed out, on sample data or when the API cannot be reached. */
export async function getFocusActive(): Promise<FocusActiveResponse | null> {
  if (USE_MOCKS) return null;
  try {
    const res = await fetch(`${API_URL}/v1/focus/active`, {
      headers: await authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const parsed = FocusActiveResponse.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** POST to one of the session routes; the session back, or the API's reason. */
export async function focusCall(path: string, body: unknown): Promise<FocusResult> {
  if (USE_MOCKS) return { ok: false, status: 501, message: "Focus now needs the live API." };
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: "" };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const session = FocusSession.safeParse(json);
    if (session.success) return { ok: true, session: session.data };
    return { ok: false, status: 502, message: "" };
  }
  const err = ApiError.safeParse(json);
  return { ok: false, status: res.status, message: err.success ? err.data.error.message : "" };
}
