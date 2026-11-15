"use server";

import { revalidatePath } from "next/cache";
import { putTarget } from "@/lib/api";
import type { MaybeAreas } from "@/lib/gamification";

export type TargetResult = { ok: boolean; message: string | null };

/** Take Michael's proposal for the week as it is. */
export async function acceptTarget(weekStart: string): Promise<TargetResult> {
  const res = await putTarget(weekStart, { accept: true });
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/goals");
  return { ok: true, message: null };
}

/** The user's own numbers; areas without time goals stay null. */
export async function setTarget(
  weekStart: string,
  overall: number,
  areas: MaybeAreas,
): Promise<TargetResult> {
  const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));
  const res = await putTarget(weekStart, {
    overall_pct: clamp(overall),
    areas: {
      business: areas.business == null ? null : clamp(areas.business),
      health: areas.health == null ? null : clamp(areas.health),
      personal: areas.personal == null ? null : clamp(areas.personal),
    },
  });
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/goals");
  return { ok: true, message: null };
}
