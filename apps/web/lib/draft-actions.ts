"use server";

import { revalidatePath } from "next/cache";
import { demoRefusal } from "./demo-refusal";
import { setDraftStatus } from "./drafts";

// Done and Not now on a follow up draft. The id comes from the browser, so it is checked first.
const ID = /^[0-9a-f-]{36}$/i;

// `error` is Michael's line when he has a better one than the generic (the demo week refuses this).
export async function markDraft(
  id: string,
  status: "done" | "dismissed",
): Promise<{ ok: boolean; error?: string }> {
  if (typeof id !== "string" || !ID.test(id) || (status !== "done" && status !== "dismissed")) {
    return { ok: false };
  }
  const r = await setDraftStatus(id, status).catch(() => ({ ok: false, status: undefined }));
  if (r.ok) {
    revalidatePath("/");
    return { ok: true };
  }
  const refused = await demoRefusal(r.status);
  return refused ? { ok: false, error: refused } : { ok: false };
}
