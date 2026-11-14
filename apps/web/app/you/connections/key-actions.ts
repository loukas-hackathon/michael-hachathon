"use server";

import type { PersonalTokenCreated } from "@michael/shared";
import { API_URL } from "@/lib/api";
import { authHeaders, isDemoVisitor } from "@/lib/caller";

export type KeyResult = { secret: string; apiBase: string } | { error: string };

// Creates a device key for the signed-in person. Demo visitors can't: keys are personal.
export async function createDeviceKey(name: string): Promise<KeyResult> {
  if (await isDemoVisitor()) {
    return { error: "Sign in with Google to connect your own devices." };
  }
  try {
    const res = await fetch(`${API_URL}/v1/tokens`, {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ name: name.slice(0, 60) }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const { secret } = (await res.json()) as PersonalTokenCreated;
    return { secret, apiBase: (process.env.PUBLIC_API_URL ?? API_URL).replace(/\/$/, "") };
  } catch {
    return { error: "I could not make your key. Sign in again and retry." };
  }
}
