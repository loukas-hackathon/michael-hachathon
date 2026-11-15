"use server";

import { ApiError, MeetingCommitmentAdd, MeetingsState } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { authHeaders } from "./caller";
import { demoRefusal } from "./demo-refusal";
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

// The after-meeting card on Today: a commitment onto today's outcomes, and a follow up draft.
const UUID = /^[0-9a-f-]{36}$/i;
export type MeetingStepResult = { ok: true } | { ok: false; message: string };

async function post(path: string, body: unknown): Promise<MeetingStepResult> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) {
      revalidatePath("/");
      return { ok: true };
    }
    const refused = await demoRefusal(res.status);
    if (refused) return { ok: false, message: refused };
    const err = ApiError.safeParse(await res.json().catch(() => null));
    return { ok: false, message: err.success ? err.data.error.message : OFFLINE };
  } catch {
    return { ok: false, message: OFFLINE };
  }
}

/** POST /v1/meetings/commitments: one commitment onto today's outcomes. */
export async function addMeetingCommitmentAction(text: string): Promise<MeetingStepResult> {
  const parsed = MeetingCommitmentAdd.safeParse({ text });
  if (!parsed.success) return { ok: false, message: "I could not read that commitment." };
  if (USE_MOCKS) return { ok: true };
  return post("/v1/meetings/commitments", parsed.data);
}

/** POST /v1/drafts/generate for the meeting's conversation. The draft lands in Follow ups. */
export async function draftMeetingFollowUpAction(eventId: string): Promise<MeetingStepResult> {
  if (typeof eventId !== "string" || !UUID.test(eventId)) {
    return { ok: false, message: "I could not find that conversation." };
  }
  if (USE_MOCKS) return { ok: true };
  return post("/v1/drafts/generate", { event_id: eventId });
}
