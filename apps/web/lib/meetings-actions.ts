"use server";

import { ApiError, MeetingsState } from "@michael/shared";
import { authHeaders } from "./caller";
import { API_URL, USE_MOCKS } from "./mode";

// Meetings mode (#400): the browser calls these; only the server talks to the API, with the
// signed-in user's token. Contract: docs/api.md, Meetings mode.

export type MeetingsResult = { ok: true; state: MeetingsState } | { ok: false; message: string };

const OFFLINE = "I could not reach the server. Nothing changed.";
let mock: MeetingsState = { consented: false, active: null, last: null };

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<MeetingsResult> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (res.ok) {
      const state = MeetingsState.safeParse(json);
      return state.success ? { ok: true, state: state.data } : { ok: false, message: OFFLINE };
    }
    const err = ApiError.safeParse(json);
    return { ok: false, message: err.success ? err.data.error.message : OFFLINE };
  } catch {
    return { ok: false, message: OFFLINE };
  }
}

export async function readMeetings(): Promise<MeetingsResult> {
  if (USE_MOCKS) return { ok: true, state: mock };
  return call("GET", "/v1/meetings/active");
}

/** `consent` is true when the user tapped Start on the consent sheet. */
export async function startMeetingAction(consent: boolean): Promise<MeetingsResult> {
  if (USE_MOCKS) {
    const now = Date.now();
    mock = {
      consented: true,
      last: mock.last,
      active: {
        id: crypto.randomUUID(),
        started_at: new Date(now).toISOString(),
        ends_at: new Date(now + 2 * 3600_000).toISOString(),
        ended_at: null,
      },
    };
    return { ok: true, state: mock };
  }
  return call("POST", "/v1/meetings/start", consent === true ? { consent: true } : {});
}

export async function endMeetingAction(): Promise<MeetingsResult> {
  if (USE_MOCKS) {
    mock = { ...mock, active: null };
    return { ok: true, state: mock };
  }
  return call("POST", "/v1/meetings/end");
}
