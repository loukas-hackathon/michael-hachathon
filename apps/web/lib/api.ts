import "server-only";
import {
  ApiError,
  type ChatHistory,
  type ChatMessage,
  type ChatResponse,
  type Goal,
  type GoalCreate,
  type GoalUpdate,
  mockEvents,
  mockGoals,
  mockRecommendations,
  type PrivacyState,
  type Recommendation,
  type Score,
  Source,
  type SourceSetting,
  type TimelineResponse,
} from "@michael/shared";
import { cookies } from "next/headers";
import { categoryOf } from "./categories";
import type { DayView } from "./day";
import type { GoalsView } from "./goals-view";
import { sampleDay, sampleEarly, sampleEmpty, sampleEvening, sampleMorning } from "./sample/day";
import { sampleGoals, sampleGoalsEmpty } from "./sample/goals";
import { dayFromScore, goalsFromScore, leadFromPatterns } from "./score-map";
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

async function get<T>(path: string): Promise<T> {
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

// Goals. With mocks, one in-process list (the sample week's goals) so the sheets work locally.
const now0 = new Date(0).toISOString();
const mockGoalStore: Goal[] = sampleGoals.goals.map((g) => ({
  id: g.id,
  category: g.category === "business" ? "work" : "gym",
  title: g.title,
  description: null,
  target: { kind: "time" },
  weekly_budget_minutes: g.budgetMinutes,
  active: true,
  created_at: now0,
  updated_at: now0,
}));
void mockGoals;

export async function getGoals(): Promise<Goal[]> {
  if (USE_MOCKS) return structuredClone(mockGoalStore);
  return (await get<{ goals: Goal[] }>("/v1/goals")).goals;
}

export type WriteResult = { ok: true } | { ok: false; message: string };

async function write(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<WriteResult> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${await bearer()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    const err = ApiError.safeParse(await res.json().catch(() => null));
    return {
      ok: false,
      message: err.success ? err.data.error.message : `${method} ${path} failed: ${res.status}`,
    };
  } catch {
    return { ok: false, message: "Michael's server can't be reached." };
  }
}

export async function createGoal(goal: GoalCreate): Promise<WriteResult> {
  if (USE_MOCKS) {
    const t = new Date().toISOString();
    mockGoalStore.push({
      id: crypto.randomUUID(),
      category: goal.category,
      title: goal.title,
      description: goal.description ?? null,
      target: goal.target ?? null,
      weekly_budget_minutes: goal.weekly_budget_minutes ?? null,
      active: goal.active ?? true,
      created_at: t,
      updated_at: t,
    });
    return { ok: true };
  }
  return write("POST", "/v1/goals", goal);
}

export async function updateGoal(id: string, patch: GoalUpdate): Promise<WriteResult> {
  if (USE_MOCKS) {
    const g = mockGoalStore.find((x) => x.id === id);
    if (!g) return { ok: false, message: "That goal no longer exists." };
    Object.assign(g, patch, { updated_at: new Date().toISOString() });
    return { ok: true };
  }
  return write("PATCH", `/v1/goals/${id}`, patch);
}

export async function deleteGoal(id: string): Promise<WriteResult> {
  if (USE_MOCKS) {
    const i = mockGoalStore.findIndex((x) => x.id === id);
    if (i >= 0) mockGoalStore.splice(i, 1);
    return { ok: true };
  }
  return write("DELETE", `/v1/goals/${id}`);
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

const athensDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(d);

/** GET /v1/score for a local day (default today). */
export async function getScore(date = athensDay()): Promise<Score> {
  return get<Score>(`/v1/score?date=${date}`);
}

/**
 * Today: planned goal blocks, what happened in them, and Michael's lead.
 * Real: GET /v1/score, with a lead from the week's patterns until the analysis (#17) is live.
 * `variant` previews the sample day's moments and states (?demo=morning|early|evening|empty|error|sample).
 */
export async function getToday(variant?: string): Promise<DayView> {
  if (variant === "error") throw new Error("Preview of the error state");
  if (variant && variant in SAMPLE_DAYS) return SAMPLE_DAYS[variant] as DayView;
  if (USE_MOCKS || variant === "sample") return sampleDay;
  const score = await getScore();
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const patterns = await get<{ phone_cadence?: { status: string; data: unknown } }>(
    `/v1/patterns?${new URLSearchParams({ from, to })}`,
  ).catch(() => ({}));
  return dayFromScore(score, leadFromPatterns(patterns, score.day.now));
}

/**
 * The week per goal. Real: GET /v1/score (per goal, per day). Sample with mocks.
 * `variant` previews states (?demo=empty|error|sample).
 */
export async function getGoalsWeek(variant?: string): Promise<GoalsView> {
  if (variant === "error") throw new Error("Preview of the error state");
  if (variant === "empty") return sampleGoalsEmpty;
  if (variant === "sample") return sampleGoals;
  if (USE_MOCKS) return sampleWeekFromStore();
  return goalsFromScore(await getScore());
}

/** The sample week, following the in-process goal list: edits, new goals and pauses show. */
function sampleWeekFromStore(): GoalsView {
  const goals = mockGoalStore
    .filter((g) => g.active && (g.weekly_budget_minutes ?? 0) > 0)
    .map((g) => {
      const known = sampleGoals.goals.find((x) => x.id === g.id);
      return {
        id: g.id,
        title: g.title,
        category: categoryOf(g.category),
        budgetMinutes: g.weekly_budget_minutes ?? 0,
        spentMinutes: known?.spentMinutes ?? 0,
        unverifiedMinutes: known?.unverifiedMinutes ?? 0,
        daily: known?.daily ?? [0, 0, 0, null, null, null, null],
      };
    });
  return { ...sampleGoals, goals };
}
