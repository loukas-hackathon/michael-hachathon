"use server";

import type { DataDeleteResult } from "@michael/shared";
import { API_URL } from "@/lib/api";
import { authHeaders, isDemoVisitor } from "@/lib/caller";

export type DeleteOutcome = { result: DataDeleteResult } | { error: string };

// DELETE /v1/me/data for the signed-in person: every row, Google access and the sign in itself.
export async function deleteEverything(): Promise<DeleteOutcome> {
  if (await isDemoVisitor()) {
    return { error: "This is the demo week. Sign in with Google to delete your own data." };
  }
  try {
    const res = await fetch(`${API_URL}/v1/me/data`, {
      method: "DELETE",
      headers: await authHeaders(),
      cache: "no-store",
    });
    if (res.status === 403) return { error: "Sign in again, then delete." };
    if (!res.ok) throw new Error(String(res.status));
    return { result: (await res.json()) as DataDeleteResult };
  } catch {
    return { error: "I lost the line. Nothing was deleted. Try again." };
  }
}
