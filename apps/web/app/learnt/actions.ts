"use server";

import { revalidatePath } from "next/cache";
import { ApiFailure } from "@/lib/api";
import { demoRefusal } from "@/lib/demo-refusal";
import { applyInsightFix } from "@/lib/insights-data";

// The one tap under a pattern (#432): Michael does the fix himself, then every screen that shows it says it is done.

export type FixResult = { ok: true } | { ok: false; message: string };

export async function applyFix(id: string, preview: boolean): Promise<FixResult> {
  try {
    await applyInsightFix(id, preview);
  } catch (e) {
    const status = e instanceof ApiFailure ? e.status : undefined;
    return { ok: false, message: (await demoRefusal(status)) ?? "I couldn't set that. Nothing changed." };
  }
  revalidatePath("/learnt");
  revalidatePath("/");
  revalidatePath("/numbers/[key]", "page");
  return { ok: true };
}
