"use server";

import { revalidatePath } from "next/cache";
import { addChecklistItem, carryChecklistItem, setChecklistStatus } from "@/lib/api";

export type ChecklistResult = { ok: boolean; message: string | null };

/** One tap: done, or back to open. Michael never ticks an item himself (#238). */
export async function tickItem(id: string, done: boolean): Promise<ChecklistResult> {
  const res = await setChecklistStatus(id, done ? "done" : "open");
  revalidatePath("/");
  return res.ok ? { ok: true, message: null } : { ok: false, message: res.message };
}

export async function addItem(goalId: string, text: string): Promise<ChecklistResult> {
  const clean = text.trim().slice(0, 200);
  if (!clean) return { ok: false, message: null };
  const res = await addChecklistItem(goalId, clean);
  revalidatePath("/");
  return res.ok ? { ok: true, message: null } : { ok: false, message: res.message };
}

export async function carryItem(id: string): Promise<ChecklistResult> {
  const res = await carryChecklistItem(id);
  revalidatePath("/");
  return res.ok ? { ok: true, message: null } : { ok: false, message: res.message };
}
