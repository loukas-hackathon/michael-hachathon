import "server-only";
import {
  type Goal,
  mockEvents,
  mockGoals,
  mockRecommendations,
  type Recommendation,
  type TimelineResponse,
} from "@michael/shared";
import type { DayView } from "./day";
import { sampleDay, sampleEarly, sampleEmpty, sampleEvening, sampleMorning } from "./sample/day";

// Server-side data access. The browser never sees API_KEY and never talks to the DB.
// USE_MOCKS=true (default) serves fixtures from @michael/shared until the real endpoint exists.
const USE_MOCKS = process.env.USE_MOCKS !== "false";
const API_URL = process.env.API_URL ?? "http://localhost:8787";
const API_KEY = process.env.API_KEY ?? "dev-key";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${API_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function getTimeline(from: string, to: string): Promise<TimelineResponse> {
  if (USE_MOCKS) return { from, to, events: mockEvents };
  const qs = new URLSearchParams({ from, to });
  return get<TimelineResponse>(`/v1/timeline?${qs}`);
}

export async function getGoals(): Promise<Goal[]> {
  if (USE_MOCKS) return mockGoals;
  return (await get<{ goals: Goal[] }>("/v1/goals")).goals;
}

export async function getRecommendations(): Promise<Recommendation[]> {
  if (USE_MOCKS) return mockRecommendations;
  return (await get<{ recommendations: Recommendation[] }>("/v1/recommendations")).recommendations;
}

const SAMPLE_DAYS: Record<string, DayView> = {
  morning: sampleMorning,
  early: sampleEarly,
  evening: sampleEvening,
  empty: sampleEmpty,
};

/**
 * Today: planned goal blocks, what happened in them, and Michael's lead.
 * Sample data until GET /v1/score, /v1/nudges and /v1/patterns are live (docs/api.md).
 * `variant` previews other moments and states of the same screen (?demo=morning|early|evening|empty).
 */
export async function getToday(variant?: string): Promise<DayView> {
  if (variant === "error") throw new Error("Preview of the error state");
  return (variant && SAMPLE_DAYS[variant]) || sampleDay;
}
