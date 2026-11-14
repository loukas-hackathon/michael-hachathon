"use server";

import type { Recommendation } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { dismissRecommendation, executeRecommendation, type RecResult, undoRecommendation } from "./api";
import { recError } from "./recommendations";

// Server functions behind the Today panel's Do it, Undo and Not now. Only the server talks to the
// API, with the signed-in user's token. The id comes from the browser, so it is checked first.

export type RecActionResult = { ok: true; rec: Recommendation } | { ok: false; error: string; gone: boolean };

const ID = /^[0-9a-f-]{36}$/i;

async function run(id: unknown, call: (id: string) => Promise<RecResult>): Promise<RecActionResult> {
  if (typeof id !== "string" || !ID.test(id)) {
    return { ok: false, error: recError(404, ""), gone: true };
  }
  let r: RecResult;
  try {
    r = await call(id);
  } catch (err) {
    console.error("recommendation action:", err);
    r = { ok: false, status: 500, message: "" };
  }
  if (!r.ok) return { ok: false, error: recError(r.status, r.message), gone: r.status === 404 };
  // The calendar changed: Today and the Timeline read it again.
  revalidatePath("/");
  revalidatePath("/timeline");
  return { ok: true, rec: r.rec };
}

export async function doRecommendation(id: string): Promise<RecActionResult> {
  return run(id, executeRecommendation);
}

export async function undoRecommendationAction(id: string): Promise<RecActionResult> {
  return run(id, undoRecommendation);
}

export async function dismissRecommendationAction(id: string): Promise<RecActionResult> {
  return run(id, dismissRecommendation);
}
