"use server";

import { revalidatePath } from "next/cache";
import { deleteInstruction, patchInstruction, postInstruction, putProfile } from "@/lib/api";
import {
  HOUSE_RULES,
  type InstructionInput,
  type InstructionKind,
  instructionText,
} from "@/lib/instructions";

export type FormState = { ok: boolean; message: string | null };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function parse(form: FormData): { input: InstructionInput } | { error: string } {
  const kind = String(form.get("kind") ?? "clear_day") as InstructionKind;
  const days = form
    .getAll("days")
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const time = String(form.get("time") ?? "");
  const text = String(form.get("text") ?? "").trim();

  if (kind === "clear_day") {
    if (!days.length) return { error: "Pick at least one day to keep clear." };
    const input: InstructionInput = { kind, days, text: "", active: true };
    return { input: { ...input, text: instructionText(input) } };
  }
  if (kind === "home_by") {
    if (!HHMM.test(time)) return { error: "Set the time, for example 21:00." };
    const input: InstructionInput = {
      kind,
      days: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
      time,
      text: "",
      active: true,
    };
    return { input: { ...input, text: instructionText(input) } };
  }
  if (!text) return { error: "Write the instruction in your own words." };
  return { input: { kind: "custom", text: text.slice(0, 140), active: true } };
}

export async function addInstruction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parse(form);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  const res = await postInstruction(parsed.input);
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/you");
  return { ok: true, message: null };
}

/** One tap: add one of the suggested house rules, by its place in HOUSE_RULES. */
export async function addHouseRule(index: number): Promise<FormState> {
  const rule = Number.isInteger(index) ? HOUSE_RULES[index] : undefined;
  if (!rule) return { ok: false, message: "That rule is not on the list." };
  const res = await postInstruction(rule);
  revalidatePath("/you");
  return res.ok ? { ok: true, message: null } : { ok: false, message: res.message };
}

export async function editInstruction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parse(form);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  const { active: _a, ...patch } = parsed.input;
  const res = await patchInstruction(id, patch);
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/you");
  return { ok: true, message: null };
}

export async function toggleInstruction(id: string, active: boolean): Promise<FormState> {
  const res = await patchInstruction(id, { active });
  revalidatePath("/you");
  return res.ok ? { ok: true, message: null } : { ok: false, message: res.message };
}

export async function removeInstruction(id: string): Promise<FormState> {
  const res = await deleteInstruction(id);
  revalidatePath("/you");
  return res.ok ? { ok: true, message: null } : { ok: false, message: res.message };
}

export async function saveQuietHours(_prev: FormState, form: FormData): Promise<FormState> {
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  if (!HHMM.test(start) || !HHMM.test(end))
    return { ok: false, message: "Set both times, for example 22:00 and 07:00." };
  try {
    await putProfile({ quiet_hours: { start, end } });
  } catch {
    return { ok: false, message: "Michael's server can't be reached." };
  }
  revalidatePath("/you");
  return { ok: true, message: null };
}
