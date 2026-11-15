"use server";

import type {
  RitualEveningInput,
  RitualEveningResponse,
  RitualKind,
  RitualMorningInput,
  RitualToday,
} from "@michael/shared";
import { revalidatePath } from "next/cache";
import { postRitualEvening, postRitualMorning, postRitualSkip, type RitualWrite } from "@/lib/api";

// The daily ritual (#318): the morning plan, the evening log and "Not today". Each returns the
// result in place (michael-feedback R4); Today refreshes behind it.

export async function saveMorning(input: RitualMorningInput): Promise<RitualWrite<RitualToday>> {
  const res = await postRitualMorning(input);
  if (res.ok) revalidatePath("/");
  return res;
}

export async function saveEvening(input: RitualEveningInput): Promise<RitualWrite<RitualEveningResponse>> {
  const res = await postRitualEvening(input);
  if (res.ok) revalidatePath("/");
  return res;
}

export async function skipHalf(kind: RitualKind): Promise<RitualWrite<RitualToday>> {
  const res = await postRitualSkip(kind);
  if (res.ok) revalidatePath("/");
  return res;
}
