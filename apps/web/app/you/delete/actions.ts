"use server";

import type { DataDeleteResult } from "@michael/shared";
import { cookies } from "next/headers";
import { API_URL, bearer } from "@/lib/api";
import { DEMO_COOKIE } from "@/lib/supabase/server";

export type DeleteOutcome = { result: DataDeleteResult } | { error: string };

// DELETE /v1/me/data for the signed-in person: every row, Google access and the sign in itself.
export async function deleteEverything(): Promise<DeleteOutcome> {
  if ((await cookies()).get(DEMO_COOKIE)?.value === "1") {
    return { error: "This is the demo week. Sign in with Google to delete your own data." };
  }
  try {
    const res = await fetch(`${API_URL}/v1/me/data`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${await bearer()}` },
      cache: "no-store",
    });
    if (res.status === 403) return { error: "Sign in again, then delete." };
    if (!res.ok) throw new Error(String(res.status));
    return { result: (await res.json()) as DataDeleteResult };
  } catch {
    return { error: "I could not reach my server. Nothing was deleted. Try again." };
  }
}
