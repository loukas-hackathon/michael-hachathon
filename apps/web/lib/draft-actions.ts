"use server";

import { revalidatePath } from "next/cache";
import { setDraftStatus } from "./drafts";

// Done and Not now on a follow up draft. The id comes from the browser, so it is checked first.
const ID = /^[0-9a-f-]{36}$/i;

export async function markDraft(id: string, status: "done" | "dismissed"): Promise<{ ok: boolean }> {
  if (typeof id !== "string" || !ID.test(id) || (status !== "done" && status !== "dismissed")) {
    return { ok: false };
  }
  const ok = await setDraftStatus(id, status).catch(() => false);
  if (ok) revalidatePath("/");
  return { ok };
}
