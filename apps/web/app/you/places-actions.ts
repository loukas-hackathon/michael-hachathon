"use server";

import type { PlaceInput } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { putPlaces } from "@/lib/api";

export type FormState = { ok: boolean; message: string | null };

const SLOTS = [
  { key: "home", label: "Home" },
  { key: "work", label: "Work" },
  { key: "gym", label: "Gym" },
] as const;

/** Home, work and gym in one save. An empty field removes that place; others the user has stay. */
export async function savePlaces(keep: PlaceInput[], _prev: FormState, form: FormData): Promise<FormState> {
  const mine: PlaceInput[] = [];
  for (const s of SLOTS) {
    const address = String(form.get(s.key) ?? "").trim();
    if (address) mine.push({ key: s.key, label: s.label, address: address.slice(0, 300) });
  }
  const others = keep.filter((p) => !SLOTS.some((s) => s.key === p.key));
  const res = await putPlaces({ places: [...mine, ...others] });
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/you", "layout");
  return { ok: true, message: null };
}
