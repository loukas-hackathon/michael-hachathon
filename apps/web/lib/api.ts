import "server-only";
import {
  ApiError,
  type ChatHistory,
  type ChatMessage,
  type ChatResponse,
  type Goal,
  mockEvents,
  mockGoals,
  mockRecommendations,
  type PrivacyState,
  type Recommendation,
  Source,
  type SourceSetting,
  type TimelineResponse,
} from "@michael/shared";
import { cookies } from "next/headers";
import type { DayView } from "./day";
import type { GoalsView } from "./goals-view";
import { sampleDay, sampleEarly, sampleEmpty, sampleEvening, sampleMorning } from "./sample/day";
import { sampleGoals, sampleGoalsEmpty } from "./sample/goals";
import { authEnabled, DEMO_COOKIE, supabaseServer } from "./supabase/server";

// Server-side data access. The browser never sees API_KEY and never talks to the DB. Each request
// carries the signed-in user's Supabase token, so the API returns only that user's data.
// USE_MOCKS=true (default) serves fixtures from @michael/shared until the real endpoint exists.
const USE_MOCKS = process.env.USE_MOCKS !== "false";
export const API_URL = process.env.API_URL ?? "http://localhost:8787";
const API_KEY = process.env.API_KEY ?? "dev-key";

// Whose data to fetch: the signed-in user's own token, or the API key for the demo week.
export async function bearer(): Promise<string> {
  if (!authEnabled) return API_KEY;
  if ((await cookies()).get(DEMO_COOKIE)?.value === "1") return API_KEY;
  const { data } = await (await supabaseServer()).auth.getSession();
  if (!data.session) throw new Error("Not signed in");
  return data.session.access_token;
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${await bearer()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function send<T>(method: "PUT" | "PATCH", path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${await bearer()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/** Chat always talks to the API: there is no fixture for a conversation. */
export async function getChatHistory(): Promise<ChatMessage[]> {
  return (await get<ChatHistory>("/v1/chat?limit=50")).messages;
}

export type ChatResult = { ok: true; data: ChatResponse } | { ok: false; code: string; message: string };

export async function sendChat(message: string): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${await bearer()}`, "content-type": "application/json" },
      body: JSON.stringify({ message }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: "network", message: "Could not reach the API" };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: body as ChatResponse };
  const err = ApiError.safeParse(body);
  return err.success
    ? { ok: false, code: err.data.error.code, message: err.data.error.message }
    : { ok: false, code: "internal", message: `POST /v1/chat failed: ${res.status}` };
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

// Privacy. With mocks, one in-process state so the switches still hold while the server runs.
const mockPrivacy: PrivacyState = {
  off_the_record: false,
  since: null,
  sources: Source.options.map((source) => ({ source, enabled: true, updated_at: new Date(0).toISOString() })),
};

export async function getPrivacy(): Promise<PrivacyState> {
  if (USE_MOCKS) return structuredClone(mockPrivacy);
  return get<PrivacyState>("/v1/privacy");
}

export async function putOffTheRecord(on: boolean): Promise<PrivacyState> {
  if (USE_MOCKS) {
    if (mockPrivacy.off_the_record !== on) {
      mockPrivacy.off_the_record = on;
      mockPrivacy.since = on ? new Date().toISOString() : null;
    }
    return structuredClone(mockPrivacy);
  }
  return send<PrivacyState>("PUT", "/v1/privacy/off-the-record", { off_the_record: on });
}

export async function patchSource(source: Source, enabled: boolean): Promise<SourceSetting> {
  if (USE_MOCKS) {
    const s = mockPrivacy.sources.find((x) => x.source === source) as SourceSetting;
    Object.assign(s, { enabled, updated_at: new Date().toISOString() });
    return { ...s };
  }
  return send<SourceSetting>("PATCH", `/v1/privacy/sources/${encodeURIComponent(source)}`, { enabled });
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

/**
 * The week per goal. Sample until GET /v1/score carries per goal, per day minutes and sleep.
 * `variant` previews states (?demo=empty|error).
 */
export async function getGoalsWeek(variant?: string): Promise<GoalsView> {
  if (variant === "error") throw new Error("Preview of the error state");
  return variant === "empty" ? sampleGoalsEmpty : sampleGoals;
}
