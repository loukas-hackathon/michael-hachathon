import "server-only";
import { ApiError, Dnd, DndOffer, NudgeTestResult } from "@michael/shared";
import { authHeaders } from "./caller";
import { API_URL, USE_MOCKS } from "./mode";

// Do Not Disturb (#447) on the API: what the hand over page shows, the tap, and ending it (the
// recommendation's own undo, so Today and this page agree).

export type DndResult = { ok: true; dnd: Dnd } | { ok: false; status: number; message: string };

/** GET /v1/dnd?nudge=, or null when signed out, on sample data or when the API cannot be reached. */
export async function getDndOffer(nudgeId?: string): Promise<DndOffer | null> {
  if (USE_MOCKS) return null;
  try {
    const query = nudgeId ? `?nudge=${encodeURIComponent(nudgeId)}` : "";
    const res = await fetch(`${API_URL}/v1/dnd${query}`, { headers: await authHeaders(), cache: "no-store" });
    if (!res.ok) return null;
    const parsed = DndOffer.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function post(path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } catch {
    return { status: 0, json: null };
  }
}

const reason = (json: unknown) => {
  const err = ApiError.safeParse(json);
  return err.success ? err.data.error.message : "";
};

/** POST /v1/dnd: the tap. */
export async function startDnd(input: { nudge_id: string } | { until: string }): Promise<DndResult> {
  if (USE_MOCKS) return { ok: false, status: 501, message: "" };
  const { status, json } = await post("/v1/dnd", input);
  const dnd = Dnd.safeParse(json);
  if (status === 201 && dnd.success) return { ok: true, dnd: dnd.data };
  return { ok: false, status: status === 201 ? 502 : status, message: reason(json) };
}

/** POST /v1/recommendations/:id/undo: ends it now. */
export async function endDnd(id: string): Promise<{ ok: boolean; status: number; message: string }> {
  if (USE_MOCKS) return { ok: false, status: 501, message: "" };
  const { status, json } = await post(`/v1/recommendations/${encodeURIComponent(id)}/undo`);
  return { ok: status === 200, status, message: reason(json) };
}

/**
 * POST /v1/nudges/test?trigger=late_phone: the phone before sleep line, sent now from the phone
 * minutes of the last hour, so the offer can be tried at any hour. The line that went out, or null.
 */
export async function sendLatePhoneNudge(): Promise<string | null> {
  if (USE_MOCKS) return null;
  const { status, json } = await post("/v1/nudges/test?trigger=late_phone");
  const sent = NudgeTestResult.safeParse(json);
  return status === 200 && sent.success ? sent.data.text : null;
}
