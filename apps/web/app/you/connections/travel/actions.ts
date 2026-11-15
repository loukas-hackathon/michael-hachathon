"use server";

import { LocationSignal, WifiMappingInput } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { mapNetwork, sendLocationSignals } from "@/lib/api";

// Server functions behind location (#267): the phone's position, and "This is Home's Wi-Fi".
// Inputs come from the browser, so they are parsed first.

export type PositionResult = { ok: true; at: string | null } | { ok: false };

/** One phone position. Demo visitors and off the record get nothing back; that is fine. */
export async function sendPosition(point: unknown): Promise<PositionResult> {
  const parsed = LocationSignal.safeParse(point);
  if (!parsed.success || parsed.data.kind !== "point") return { ok: false };
  try {
    const r = await sendLocationSignals([parsed.data]);
    return r && r.recorded > 0 ? { ok: true, at: r.at } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export type MapResult = { ok: true } | { ok: false; message: string };

/** "This is Home's Wi-Fi", or forget a network with a null place. */
export async function assignNetwork(network: unknown, placeKey: unknown): Promise<MapResult> {
  const input = WifiMappingInput.safeParse({ network, place_key: placeKey });
  if (!input.success) return { ok: false, message: "That network does not look right." };
  try {
    await mapNetwork(input.data.network, input.data.place_key);
  } catch {
    return { ok: false, message: "I could not save that. Nothing changed." };
  }
  revalidatePath("/you/connections/travel");
  revalidatePath("/timeline");
  return { ok: true };
}

/** After the one tap ask: refresh the page so the status line shows where you are. */
export async function refreshLocation() {
  revalidatePath("/you/connections/travel");
  revalidatePath("/you");
}
