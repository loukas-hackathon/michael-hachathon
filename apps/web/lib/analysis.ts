import "server-only";
import { type AnalysisResult, ApiError, mockAnalysisRun, mockRecommendations } from "@michael/shared";
import { cache } from "react";
import { authHeaders } from "./caller";
import { API_URL, USE_MOCKS } from "./mode";

// Michael's brief on demand (POST /v1/analysis/run) and the last one he wrote
// (GET /v1/analysis/latest). Kept out of lib/api.ts so it can change without touching the shared file.

export type BriefResult =
  | { ok: true; result: AnalysisResult }
  | { ok: false; status: number; message: string };

const mockResult = (): AnalysisResult => ({
  run: { ...mockAnalysisRun, finished_at: new Date().toISOString() },
  recommendations: structuredClone(mockRecommendations),
});

/** The latest run, or null when none has run yet or it cannot load (the card then offers the button). */
// Once per render (React cache), so Today can start it early and the brief card reuses it.
export const getLatestBrief = cache(async (): Promise<AnalysisResult | null> => {
  if (USE_MOCKS) return null;
  try {
    const res = await fetch(`${API_URL}/v1/analysis/latest`, {
      headers: await authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as AnalysisResult;
  } catch (err) {
    console.error("latest brief:", err);
    return null;
  }
});

/** Ask Michael for a brief now. 502 (the model failed) and 503 (no model key) come back as values. */
export async function runBrief(): Promise<BriefResult> {
  if (USE_MOCKS) return { ok: true, result: mockResult() };
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/analysis/run`, {
      method: "POST",
      headers: await authHeaders(),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: "Could not reach the API" };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, result: json as AnalysisResult };
  const err = ApiError.safeParse(json);
  return { ok: false, status: res.status, message: err.success ? err.data.error.message : "" };
}

/** One line in Michael's voice for a failed run. */
export function briefError(status: number): string {
  if (status === 503) return "I can't write briefs on this server yet. The model key is missing.";
  if (status === 502) return "I could not finish the brief this time. Try again in a minute.";
  if (status === 401) return "Sign in again and I will brief you.";
  if (status === 0) return "I can't reach the server right now. Try again in a minute.";
  return "Something went wrong on my side. Try again in a minute.";
}
