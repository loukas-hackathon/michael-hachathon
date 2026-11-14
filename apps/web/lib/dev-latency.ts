// Pretend the API is slow, to see and measure loading states locally (skeletons, Suspense, CLS).
// MOCK_LATENCY_MS=900 in apps/web/.env.local; unset (the default, and in every deployment) costs nothing.
const MS = Number(process.env.MOCK_LATENCY_MS ?? 0);

export function devLatency(): Promise<void> {
  return MS > 0 ? new Promise((resolve) => setTimeout(resolve, MS)) : Promise.resolve();
}
