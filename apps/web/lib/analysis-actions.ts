"use server";

import type { AnalysisRun } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { briefError, runBrief } from "./analysis";

// Server function behind "Ask Michael for a brief" on Today. Only the server talks to the API.

export type BriefActionResult =
  | { ok: true; run: AnalysisRun; suggestions: number }
  | { ok: false; error: string };

export async function askForBrief(): Promise<BriefActionResult> {
  const r = await runBrief().catch((err) => {
    console.error("ask for brief:", err);
    return { ok: false as const, status: 500, message: "" };
  });
  if (!r.ok) return { ok: false, error: briefError(r.status) };
  // New suggestions land in the "Michael suggests" panel on the next render.
  revalidatePath("/");
  return { ok: true, run: r.result.run, suggestions: r.result.recommendations.length };
}
