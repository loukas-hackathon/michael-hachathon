"use server";

import { KnowledgeKind, type Profile, WeakSpot } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { API_URL, get } from "@/lib/api";
import { authHeaders } from "@/lib/caller";
import { demoRefusal } from "@/lib/demo-refusal";

// Forget one thing on "What I know about you" (#379), through the route that owns it, so the row
// is really deleted (docs/api.md). Called after the five second Undo has run out.

export type ForgetResult = { ok: true } | { ok: false; error: string };

const FAILED = "I could not forget that. It is still here.";

async function remove(path: string): Promise<number> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers: await authHeaders(),
    cache: "no-store",
  });
  // Already gone counts as forgotten.
  return res.status === 404 ? 204 : res.status;
}

/** One entry of a profile list: PUT /v1/profile without it. */
async function dropFromProfile(id: string): Promise<number> {
  const [field, ...rest] = id.split(":");
  const value = rest.join(":");
  if ((field !== "weak_spots" && field !== "fixed_titles") || !value) return 400;
  if (field === "weak_spots" && !WeakSpot.safeParse(value).success) return 400;
  const profile = await get<Profile>("/v1/profile");
  const list = (profile[field] as string[]).filter((v) => v !== value);
  const res = await fetch(`${API_URL}/v1/profile`, {
    method: "PUT",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify({ [field]: list }),
    cache: "no-store",
  });
  return res.status;
}

export async function forgetItem(kind: string, id: string): Promise<ForgetResult> {
  const k = KnowledgeKind.safeParse(kind);
  if (!k.success || typeof id !== "string" || !id || id.length > 300) return { ok: false, error: FAILED };
  const ref = encodeURIComponent(id);
  let status: number;
  try {
    status =
      k.data === "memory"
        ? await remove(`/v1/events/${ref}`)
        : k.data === "check_in"
          ? await remove(`/v1/check-in/${ref}`)
          : k.data === "instruction"
            ? await remove(`/v1/instructions/${ref}`)
            : await dropFromProfile(id);
  } catch {
    return { ok: false, error: "I could not reach the server. It is still here." };
  }
  if (status < 300) {
    revalidatePath("/you/knowledge");
    return { ok: true };
  }
  return { ok: false, error: (await demoRefusal(status)) ?? FAILED };
}
