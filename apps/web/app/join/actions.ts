"use server";

import { WaitlistCode, type WaitlistJoin, WaitlistStanding } from "@michael/shared";
import { headers } from "next/headers";
import { API_KEY, API_URL } from "@/lib/mode";

// Joining the waiting list (/join). Server to server, as every call to the API: the visitor's
// address rides in X-Michael-Client-IP next to the API key, so the API's limit of 10 sign ups an
// hour counts the visitor, not this server.

export type JoinResult = { ok: true; code: string } | { ok: false; line: string };

export async function joinWaitlist(input: WaitlistJoin): Promise<JoinResult> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/waitlist`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
        ...(ip ? { "x-michael-client-ip": ip } : {}),
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return { ok: false, line: "I could not reach the list. Try again in a minute." };
  }
  if (res.status === 429) return { ok: false, line: "Too many sign ups from here. Try again in an hour." };
  if (res.status === 400)
    return { ok: false, line: "Check your email and the answers above, then try again." };
  if (!res.ok) return { ok: false, line: "I could not add you just now. Try again in a minute." };
  const standing = WaitlistStanding.safeParse(await res.json().catch(() => null));
  if (!standing.success) return { ok: false, line: "I could not add you just now. Try again in a minute." };
  return { ok: true, code: standing.data.referral_code };
}

/**
 * Founding member, from the thank you page (PATCH /v1/waitlist/:code). The code is the only key:
 * whoever holds the link may change this one answer, nothing else.
 */
export async function setFoundingMember(code: string, on: boolean): Promise<{ ok: boolean }> {
  if (!WaitlistCode.safeParse(code).success) return { ok: false };
  try {
    const res = await fetch(`${API_URL}/v1/waitlist/${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ founding_member: on }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    const standing = WaitlistStanding.safeParse(await res.json().catch(() => null));
    return { ok: standing.success && standing.data.founding_member === on };
  } catch {
    return { ok: false };
  }
}
