import "server-only";
import type { Draft, DraftStatus } from "@michael/shared";
import { get } from "./api";
import { authHeaders } from "./caller";
import { API_URL, USE_MOCKS } from "./mode";

// Follow up drafts (GET/PATCH /v1/drafts): Michael writes them, the user copies and sends them.
// Nothing here sends anything. USE_MOCKS serves one sample draft so the section can be seen offline.

const at = new Date().toISOString();
const mockDrafts: Draft[] = [
  {
    id: "5f0d3c1e-7a51-4c3e-9a51-3d2f7c9b0a11",
    event_id: null,
    recommendation_id: null,
    title: "Customer call: onboarding feedback",
    event_at: at,
    channel: "email",
    subject: "Following up: Customer call",
    body: "Hi,\n\nThanks for your time today. Quick recap from my side: the pilot team likes the weekly view but finds setup too long.\n\nWhat I am doing next:\n1. Write up the onboarding steps you skipped\n2. Follow up with pricing by Monday\n\nBest,",
    written_by: "template",
    status: "proposed",
    created_at: at,
    updated_at: at,
  },
];

/** Drafts waiting for the user, newest first. */
export async function getOpenDrafts(): Promise<Draft[]> {
  if (USE_MOCKS) return mockDrafts.filter((d) => d.status === "proposed");
  return (await get<{ drafts: Draft[] }>("/v1/drafts?status=proposed")).drafts;
}

/**
 * PATCH /v1/drafts/:id. Not ok when it failed (the caller says so in Michael's words), with the
 * API's status when it answered.
 */
export async function setDraftStatus(
  id: string,
  status: DraftStatus,
): Promise<{ ok: boolean; status?: number }> {
  if (USE_MOCKS) {
    const d = mockDrafts.find((x) => x.id === id);
    if (d) d.status = status;
    return { ok: Boolean(d) };
  }
  const res = await fetch(`${API_URL}/v1/drafts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify({ status }),
    cache: "no-store",
  }).catch(() => null);
  return { ok: Boolean(res?.ok), status: res?.status };
}
