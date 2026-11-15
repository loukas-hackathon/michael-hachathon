import "server-only";
import { API_URL, ApiFailure } from "./api";
import { authHeaders } from "./caller";
import { devLatency } from "./dev-latency";
import { type Insights, sortInsights } from "./insights";
import { USE_MOCKS } from "./mode";
import { sampleInsights, sampleInsightsStudying, sampleInsightsWatching } from "./sample/insights";

// GET /v1/insights (#432). Real data is the API only: a pattern Michael has not found must never
// show on a real account. Mocks and ?demo= previews read lib/sample/insights.ts. Null when the
// API cannot be read, so each screen says so in its own words.

const PREVIEWS: Record<string, Insights> = {
  sample: sampleInsights,
  studying: sampleInsightsStudying,
  watching: sampleInsightsWatching,
};

/** True when a ?demo= value previews fixed insights, so a one tap never reaches the API. */
export function isInsightsPreview(variant?: string): boolean {
  return Boolean(variant && variant in PREVIEWS);
}

/** One tap fixes taken in this server process, so the mock answers like the API would. */
const appliedInMocks = new Map<string, string>();

function withApplied(view: Insights): Insights {
  return {
    ...view,
    insights: view.insights.map((i) =>
      i.fix && appliedInMocks.has(i.id)
        ? { ...i, fix: { ...i.fix, applied_at: appliedInMocks.get(i.id) } }
        : i,
    ),
  };
}

export async function getInsights(variant?: string): Promise<Insights | null> {
  await devLatency();
  const preview = variant ? PREVIEWS[variant] : undefined;
  if (preview) return withApplied(preview);
  if (USE_MOCKS) return withApplied(sampleInsights);
  try {
    const res = await fetch(`${API_URL}/v1/insights`, { headers: await authHeaders(), cache: "no-store" });
    if (!res.ok) return null;
    const view = (await res.json()) as Insights;
    const { patterns, watching } = sortInsights(view.insights);
    return { ...view, insights: [...patterns, ...watching] };
  } catch {
    return null;
  }
}

/** The one tap under a pattern. Mocks remember it for this process; real: POST /v1/insights/:id/fix. */
export async function applyInsightFix(id: string, preview: boolean): Promise<void> {
  if (USE_MOCKS || preview) {
    appliedInMocks.set(id, new Date().toISOString());
    return;
  }
  const res = await fetch(`${API_URL}/v1/insights/${encodeURIComponent(id)}/fix`, {
    method: "POST",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new ApiFailure(`POST /v1/insights/${id}/fix failed: ${res.status}`, res.status);
}
