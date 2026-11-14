import "server-only";
import {
  type AddressSearchResponse,
  ApiError,
  type ChatHistory,
  type ChatResponse,
  type CheckInAnswerResponse,
  type CheckInToday,
  type CheckInValue,
  DEFAULT_PROFILE,
  demoRecommendations,
  type Goal,
  type GoalCreate,
  type GoalSuggestion,
  type GoalSuggestionAccept,
  type GoalUpdate,
  mockEvents,
  mockGoals,
  mockRecommendations,
  mockScore,
  type NudgeTestResult,
  type PlaceSuggestionsResponse,
  type PlacesResponse,
  type PlacesUpdate,
  type PrivacyState,
  type Profile,
  type ProfileUpdate,
  type PushConfig,
  type PushSubscriptionInput,
  type Recommendation,
  type Score,
  Source,
  type SourceSetting,
  type TargetResponse,
  type TargetUpdate,
  type TimelineResponse,
} from "@michael/shared";
import { cache } from "react";
import { authHeaders } from "./caller";
import { categoryOf } from "./categories";
import type { ChecklistDay, ChecklistItem } from "./checklist";
import type { DayView } from "./day";
import type { GoalsView } from "./goals-view";
import type { Instruction, InstructionInput } from "./instructions";
import { causesFrom, type LostWeek, lostWeekFrom } from "./lost-week";
import { API_URL, USE_MOCKS } from "./mode";
import { sampleChecklist } from "./sample/checklist";
import {
  sampleDay,
  sampleEarly,
  sampleEmpty,
  sampleEvening,
  sampleMissed,
  sampleMorning,
} from "./sample/day";
import { sampleGoals, sampleGoalsBaseline, sampleGoalsEmpty, sampleGoalsMonday } from "./sample/goals";
import { dayFromScore, goalsFromScore, leadFromPatterns } from "./score-map";

// Server-side data access. The browser never sees API_KEY and never talks to the DB. Each request
// carries the signed-in user's Supabase token, so the API returns only that user's data.
// Fixtures only with USE_MOCKS (lib/mode.ts): real data is the default, ?demo=sample previews.
export { API_URL };

// Whose data to fetch (a session always beats the demo cookie): authHeaders in lib/caller.ts.

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function send<T>(method: "PUT" | "PATCH" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The raw server-sent event stream of POST /v1/chat/stream, for the /chat/stream route to pass on.
 * Throws when signed out or the API cannot be reached.
 */
export async function openChatStream(message: string): Promise<Response> {
  return fetch(`${API_URL}/v1/chat/stream`, {
    method: "POST",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify({ message }),
    cache: "no-store",
  });
}

/** GET /v1/check-in (#187): today's questions; the API opens a round when one is due. */
export async function getCheckIn(): Promise<CheckInToday> {
  return get<CheckInToday>("/v1/check-in");
}

/** POST /v1/check-in/:id/answer: the answer, and the follow up it calls for. */
export async function answerCheckIn(id: string, value: CheckInValue): Promise<CheckInAnswerResponse> {
  return send<CheckInAnswerResponse>("POST", `/v1/check-in/${encodeURIComponent(id)}/answer`, { value });
}

/** Chat always talks to the API: there is no fixture for a conversation. */
export async function getChatHistory(): Promise<ChatHistory> {
  const body = await get<ChatHistory>("/v1/chat?limit=50");
  // An API from before action_ids still answers: no chips come back, the lines do.
  return {
    messages: body.messages.map((m) => ({ ...m, action_ids: m.action_ids ?? [] })),
    actions: body.actions ?? [],
  };
}

export type ChatResult = { ok: true; data: ChatResponse } | { ok: false; code: string; message: string };

export async function sendChat(message: string): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/chat`, {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
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

/** Whether the API can speak with ElevenLabs. False when it cannot say: the browser voice is fine. */
export async function getVoiceEnabled(): Promise<boolean> {
  try {
    return (await get<{ elevenlabs: boolean }>("/v1/voice")).elevenlabs;
  } catch {
    return false;
  }
}

/** Michael's reply as audio/mpeg from POST /v1/voice/speak, or null so the browser speaks instead. */
export async function speak(text: string): Promise<Response | null> {
  try {
    const res = await fetch(`${API_URL}/v1/voice/speak`, {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });
    if (res.ok && res.body) return res;
    console.error(`voice: POST /v1/voice/speak failed: ${res.status}`);
    return null;
  } catch (err) {
    console.error("voice:", err);
    return null;
  }
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
// The sample checklist and count goals (#238), so the edit sheet and Today's list find them.
for (const g of sampleGoals.extras ?? []) {
  mockGoalStore.push({
    id: g.id,
    category: g.category === "business" ? "work" : "gym",
    title: g.title,
    description: null,
    target:
      g.kind === "count" ? { kind: "count", per_week: g.count?.target ?? 1 } : { kind: g.kind ?? "time" },
    weekly_budget_minutes: 0,
    active: true,
    created_at: now0,
    updated_at: now0,
  });
}
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
      headers: { ...(await authHeaders()), "content-type": "application/json" },
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

export async function postGoal(goal: GoalCreate): Promise<WriteResult> {
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

export async function patchGoal(id: string, patch: GoalUpdate): Promise<WriteResult> {
  if (USE_MOCKS) {
    const g = mockGoalStore.find((x) => x.id === id);
    if (!g) return { ok: false, message: "That goal no longer exists." };
    Object.assign(g, patch, { updated_at: new Date().toISOString() });
    return { ok: true };
  }
  return write("PATCH", `/v1/goals/${id}`, patch);
}

export async function removeGoalById(id: string): Promise<WriteResult> {
  if (USE_MOCKS) {
    const i = mockGoalStore.findIndex((x) => x.id === id);
    if (i >= 0) mockGoalStore.splice(i, 1);
    return { ok: true };
  }
  return write("DELETE", `/v1/goals/${id}`);
}

/** Goals Michael reads off the user's own calendar (#134). Empty with mocks or when the API is down. */
export async function getGoalSuggestions(): Promise<GoalSuggestion[]> {
  if (USE_MOCKS) return [];
  try {
    return (await get<{ suggestions: GoalSuggestion[] }>("/v1/goals/suggestions")).suggestions;
  } catch {
    return [];
  }
}

export async function acceptGoalSuggestion(
  id: string,
  edits: GoalSuggestionAccept = {},
): Promise<WriteResult> {
  if (USE_MOCKS) return { ok: false, message: "Suggestions need the live API." };
  return write("POST", `/v1/goals/suggestions/${encodeURIComponent(id)}/accept`, edits);
}
// With mocks, one in-process list so Do it, Undo and Not now still hold while the server runs.
let mockRecs: Recommendation[] | null = null;
const mockRecList = () => {
  mockRecs ??= [...structuredClone(mockRecommendations), ...demoRecommendations()];
  return mockRecs;
};

export async function getRecommendations(): Promise<Recommendation[]> {
  if (USE_MOCKS) return structuredClone(mockRecList());
  return (await get<{ recommendations: Recommendation[] }>("/v1/recommendations")).recommendations;
}

export type RecResult = { ok: true; rec: Recommendation } | { ok: false; status: number; message: string };

// Chat always talks to the API, so a recommendation it made is not in the mock list: send those on.
const isMockRec = (id: string) => mockRecList().some((r) => r.id === id);

/** The same rules the API applies (apps/api/src/actions/calendar.ts), on the in-memory list. */
function mockRecAction(id: string, op: "execute" | "undo" | "dismiss"): RecResult {
  const rec = mockRecList().find((r) => r.id === id);
  if (!rec) return { ok: false, status: 404, message: "Recommendation not found" };
  const fail = (message: string): RecResult => ({ ok: false, status: 409, message });
  const now = new Date().toISOString();
  const start = rec.action?.payload.start_at;
  if (op === "dismiss") {
    Object.assign(rec, { status: "dismissed", updated_at: now });
  } else if (op === "execute") {
    if (!rec.action) return fail("This recommendation has nothing to carry out");
    if (rec.status === "done") return fail("Already done");
    if (rec.status === "dismissed") return fail("This recommendation was dismissed");
    if (rec.action.involves_others) return fail("This involves other people. I only advise on it.");
    if (typeof start === "string" && Date.parse(start) <= Date.now())
      return fail("That time has already started");
    Object.assign(rec, { status: "done", executed_at: now, undone_at: null, updated_at: now });
  } else {
    if (rec.status !== "done") return fail("Only a done recommendation can be undone");
    const until = rec.action?.undo_until ?? start;
    if (typeof until === "string" && Date.parse(until) <= Date.now())
      return fail("Too late to undo: the block has started");
    Object.assign(rec, { status: "undone", undone_at: now, updated_at: now });
  }
  return { ok: true, rec: structuredClone(rec) };
}

async function recCall(method: "POST" | "PATCH", path: string, body?: unknown): Promise<RecResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: "Could not reach the API" };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, rec: json as Recommendation };
  const err = ApiError.safeParse(json);
  return {
    ok: false,
    status: res.status,
    message: err.success ? err.data.error.message : `${method} ${path}`,
  };
}

/** POST /v1/recommendations/:id/execute: Michael carries out the action on the user's own time. */
export async function executeRecommendation(id: string): Promise<RecResult> {
  if (USE_MOCKS && isMockRec(id)) return mockRecAction(id, "execute");
  return recCall("POST", `/v1/recommendations/${encodeURIComponent(id)}/execute`);
}

/** POST /v1/recommendations/:id/undo, allowed until the block starts. */
export async function undoRecommendation(id: string): Promise<RecResult> {
  if (USE_MOCKS && isMockRec(id)) return mockRecAction(id, "undo");
  return recCall("POST", `/v1/recommendations/${encodeURIComponent(id)}/undo`);
}

/** PATCH /v1/recommendations/:id { status: dismissed }: "Not now". */
export async function dismissRecommendation(id: string): Promise<RecResult> {
  if (USE_MOCKS && isMockRec(id)) return mockRecAction(id, "dismiss");
  return recCall("PATCH", `/v1/recommendations/${encodeURIComponent(id)}`, { status: "dismissed" });
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

// Nudges on this device (Web Push). Mocks have no push service, so the button explains that.
export async function getPushConfig(): Promise<PushConfig> {
  if (USE_MOCKS) return { enabled: false, public_key: null, devices: 0 };
  return get<PushConfig>("/v1/push");
}

export async function postPushSubscription(sub: PushSubscriptionInput): Promise<PushConfig> {
  return send<PushConfig>("POST", "/v1/push/subscriptions", sub);
}

export async function postTestNudge(): Promise<NudgeTestResult> {
  return send<NudgeTestResult>("POST", "/v1/nudges/test");
}

const SAMPLE_DAYS: Record<string, DayView> = {
  morning: sampleMorning,
  early: sampleEarly,
  evening: sampleEvening,
  empty: sampleEmpty,
  missed: sampleMissed,
};

const athensDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(d);

/** GET /v1/score for a local day (default today). */
// Deduped per request: Today asks for the score twice (the day and the week's lost time).
const scoreFor = cache((date: string) => get<Score>(`/v1/score?date=${date}`));
export async function getScore(date = athensDay()): Promise<Score> {
  return scoreFor(date);
}

/** Goal time lost per day of the week holding `date` (Timeline chart, Today's week line). */
export async function getLostWeek(date?: string, variant?: string): Promise<LostWeek | null> {
  if (USE_MOCKS || variant === "sample") {
    return { ...lostWeekFrom(mockScore, mockScore.date), causes: causesFrom([mockScore]) };
  }
  try {
    const today = athensDay();
    const week = lostWeekFrom(await getScore(date ?? today), today);
    // What took it: the score names causes for one day at a time, so read each past day that lost
    // time (at most seven, in parallel, deduped with the call above). TODO: a week total from the API.
    const days = week.days.filter((d) => (d.lost ?? 0) > 0).map((d) => d.date);
    const scores = await Promise.all(days.map((d) => getScore(d).catch(() => null)));
    return { ...week, causes: causesFrom(scores.filter((x): x is Score => x != null)) };
  } catch {
    return null;
  }
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
  if (variant === "monday") return sampleGoalsMonday;
  if (variant === "baseline") return sampleGoalsBaseline;
  if (variant === "sample") return sampleGoals;
  if (USE_MOCKS) return sampleWeekFromStore();
  const [score, targets] = await Promise.all([getScore(), getTargets().catch(() => null)]);
  return goalsFromScore(score, targets);
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
        plannedMinutes: known?.plannedMinutes,
        openBlocks: known?.openBlocks,
        daily: known?.daily ?? [0, 0, 0, null, null, null, null],
      };
    });
  return { ...sampleGoals, goals };
}

// ---------- profile and onboarding (docs/api.md, Profile) ----------

// With mocks, one in-process profile so onboarding can be walked through without the API.
let mockProfile: Profile = structuredClone(DEFAULT_PROFILE);

export async function getProfile(): Promise<Profile> {
  if (USE_MOCKS) return structuredClone(mockProfile);
  return get<Profile>("/v1/profile");
}

export async function putProfile(patch: ProfileUpdate): Promise<Profile> {
  if (USE_MOCKS) {
    mockProfile = { ...mockProfile, ...patch, updated_at: new Date().toISOString() };
    return structuredClone(mockProfile);
  }
  return send<Profile>("PUT", "/v1/profile", patch);
}

export async function createGoal(input: GoalCreate): Promise<Goal | null> {
  if (USE_MOCKS) return null;
  const res = await fetch(`${API_URL}/v1/goals`, {
    method: "POST",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`POST /v1/goals failed: ${res.status}`);
  return (await res.json()) as Goal;
}

/** A new user (no goals, never onboarded) starts with the talk. Fails open: Today always renders. */
export async function needsOnboarding(): Promise<boolean> {
  if (USE_MOCKS) return false;
  try {
    const [goals, profile] = await Promise.all([getGoals(), getProfile()]);
    return goals.length === 0 && profile.onboarded_at === null;
  } catch {
    return false;
  }
}

// ---------- standing instructions (/v1/instructions, landing with #131) ----------

const mockInstructions: Instruction[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    text: "Keep Sundays clear",
    kind: "clear_day",
    days: [0],
    active: true,
    created_at: now0,
    updated_at: now0,
  },
];

export type InstructionsResult = { available: true; items: Instruction[] } | { available: false };

/** Not live yet answers `available: false`, so the screen can say so instead of failing. */
export async function getInstructions(): Promise<InstructionsResult> {
  if (USE_MOCKS) return { available: true, items: structuredClone(mockInstructions) };
  const res = await fetch(`${API_URL}/v1/instructions`, {
    headers: await authHeaders(),
    cache: "no-store",
  }).catch(() => null);
  if (!res || res.status === 404 || res.status === 501) return { available: false };
  if (!res.ok) throw new Error(`GET /v1/instructions failed: ${res.status}`);
  const body = (await res.json()) as { instructions: Instruction[] };
  return { available: true, items: body.instructions };
}

export async function postInstruction(input: InstructionInput): Promise<WriteResult> {
  if (USE_MOCKS) {
    const t = new Date().toISOString();
    mockInstructions.push({ ...input, id: crypto.randomUUID(), created_at: t, updated_at: t });
    return { ok: true };
  }
  return write("POST", "/v1/instructions", input);
}

export async function patchInstruction(id: string, patch: Partial<InstructionInput>): Promise<WriteResult> {
  if (USE_MOCKS) {
    const i = mockInstructions.find((x) => x.id === id);
    if (!i) return { ok: false, message: "That instruction no longer exists." };
    Object.assign(i, patch, { updated_at: new Date().toISOString() });
    return { ok: true };
  }
  return write("PATCH", `/v1/instructions/${id}`, patch);
}

export async function deleteInstruction(id: string): Promise<WriteResult> {
  if (USE_MOCKS) {
    const at = mockInstructions.findIndex((x) => x.id === id);
    if (at >= 0) mockInstructions.splice(at, 1);
    return { ok: true };
  }
  return write("DELETE", `/v1/instructions/${id}`);
}

// ---------- places (GET/PUT /v1/places, #115) ----------

const mockPlaces: PlacesResponse = { places: [], maps_available: false, travel_enabled: false };

export async function getPlaces(): Promise<PlacesResponse> {
  if (USE_MOCKS) return structuredClone(mockPlaces);
  return get<PlacesResponse>("/v1/places");
}

/** Address matches for the Places screen, geocoded by the API (the browser never holds a maps key). */
export async function searchPlaces(q: string): Promise<AddressSearchResponse> {
  if (USE_MOCKS) return { results: [], maps_available: false };
  return get<AddressSearchResponse>(`/v1/places/search?${new URLSearchParams({ q })}`);
}

/** Places the user often looks up in Google Maps, offered for saving (#223). Empty while maps is off. */
export async function getPlaceSuggestions(): Promise<PlaceSuggestionsResponse> {
  if (USE_MOCKS) return { enabled: false, suggestions: [] };
  return get<PlaceSuggestionsResponse>("/v1/places/suggestions");
}

/** PUT replaces the whole list; saving places is the user's opt in to travel times. */
export async function putPlaces(update: PlacesUpdate): Promise<WriteResult> {
  if (USE_MOCKS) {
    const t = new Date().toISOString();
    mockPlaces.places = update.places.map((p) => ({
      key: p.key,
      label: p.label ?? p.key,
      address: p.address ?? null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      updated_at: t,
    }));
    return { ok: true };
  }
  try {
    const res = await fetch(`${API_URL}/v1/places`, {
      method: "PUT",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify(update),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    const err = ApiError.safeParse(await res.json().catch(() => null));
    return {
      ok: false,
      message: err.success ? err.data.error.message : `PUT /v1/places failed: ${res.status}`,
    };
  } catch {
    return { ok: false, message: "Michael's server can't be reached." };
  }
}

// ---------- weekly targets (#165) ----------

export async function getTargets(): Promise<TargetResponse> {
  return get<TargetResponse>("/v1/targets/current");
}

/** Accept Michael's proposal ({ accept: true }) or set the user's own numbers. */
export async function putTarget(weekStart: string, update: TargetUpdate): Promise<WriteResult> {
  if (USE_MOCKS) return { ok: true };
  try {
    const res = await fetch(`${API_URL}/v1/targets/${weekStart}`, {
      method: "PUT",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify(update),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    const err = ApiError.safeParse(await res.json().catch(() => null));
    return {
      ok: false,
      message: err.success ? err.data.error.message : `PUT /v1/targets failed: ${res.status}`,
    };
  } catch {
    return { ok: false, message: "Michael's server can't be reached." };
  }
}

// ---------- the day's checklist (/v1/checklist, #238) ----------

const mockChecklist: ChecklistDay = structuredClone(sampleChecklist);

/** Null while the endpoint is not live (404), so Today simply leaves the list out. */
export async function getChecklist(date?: string): Promise<ChecklistDay | null> {
  if (USE_MOCKS) return structuredClone(mockChecklist);
  const qs = date ? `?date=${date}` : "";
  const res = await fetch(`${API_URL}/v1/checklist${qs}`, {
    headers: await authHeaders(),
    cache: "no-store",
  }).catch(() => null);
  if (!res || res.status === 404 || res.status === 501) return null;
  if (!res.ok) throw new Error(`GET /v1/checklist failed: ${res.status}`);
  return (await res.json()) as ChecklistDay;
}

export async function addChecklistItem(goalId: string, text: string): Promise<WriteResult> {
  if (USE_MOCKS) {
    const open = mockChecklist.items.filter((i) => i.goal_id === goalId && i.status === "open").length;
    if (open >= 3) return { ok: false, message: "Three is the most for one day." };
    const t = new Date().toISOString();
    mockChecklist.items.push({
      id: crypto.randomUUID(),
      goal_id: goalId,
      date: mockChecklist.date,
      text,
      position: mockChecklist.items.length,
      status: "open",
      settled_at: null,
      settled_by: null,
      carried_from: null,
      created_at: t,
      updated_at: t,
    });
    return { ok: true };
  }
  return write("POST", "/v1/checklist", { goal_id: goalId, text });
}

export async function setChecklistStatus(id: string, status: ChecklistItem["status"]): Promise<WriteResult> {
  if (USE_MOCKS) {
    const i = mockChecklist.items.find((x) => x.id === id);
    if (!i) return { ok: false, message: "That item no longer exists." };
    const t = new Date().toISOString();
    Object.assign(i, {
      status,
      settled_at: status === "open" ? null : t,
      settled_by: status === "open" ? null : "user",
      updated_at: t,
    });
    return { ok: true };
  }
  return write("PATCH", `/v1/checklist/${id}`, { status });
}

/** Yesterday's open item continues today (POST /v1/checklist/:id/carry). */
export async function carryChecklistItem(id: string): Promise<WriteResult> {
  if (USE_MOCKS) {
    const at = mockChecklist.suggestions.findIndex((x) => x.id === id);
    const s = mockChecklist.suggestions[at];
    if (!s) return { ok: false, message: "That item no longer exists." };
    mockChecklist.suggestions.splice(at, 1);
    const t = new Date().toISOString();
    mockChecklist.items.push({
      ...s,
      id: crypto.randomUUID(),
      date: mockChecklist.date,
      carried_from: s.id,
      created_at: t,
      updated_at: t,
    });
    return { ok: true };
  }
  return write("POST", `/v1/checklist/${id}/carry`);
}
