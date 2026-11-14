import {
  type AnalysisRun,
  type ChatMessage,
  type ChatRole,
  type Event,
  type EventInput,
  type EventType,
  type Goal,
  type GoalCreate,
  type GoalUpdate,
  type Integration,
  type IntegrationProvider,
  mockAnalysisRun,
  mockEvents,
  mockGoals,
  mockRecommendations,
  type Nudge,
  type NudgeStatus,
  type Place,
  type Profile,
  type Recommendation,
  type RecommendationStatus,
  type Source,
  type SourceSetting,
} from "@michael/shared";
import type { z } from "zod";
import { currentUserId } from "./context";
import { env } from "./env";
import type { GeocodeHit } from "./integrations/maps";
import { type PrivacyBackend, type PrivacyRules, screenEvents } from "./privacy";
import { SupabaseStore } from "./supabase-store";

export interface TimelineFilter {
  from: string;
  to: string;
  source?: Source[];
  type?: EventType[];
}

export type NewRecommendation = Pick<Recommendation, "goal_id" | "title" | "rationale" | "action"> & {
  analysis_run_id?: string | null;
  source?: Recommendation["source"];
};

export interface InsertResult {
  inserted: Event[];
  duplicates: number;
  // Dropped by privacy settings (source off / off the record), see privacy.ts.
  ignored: number;
}

// An integration row with its secrets. Tokens never leave apps/api: routes answer with
// `publicIntegration`, which drops them.
export interface IntegrationRecord extends Integration {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
}
export type IntegrationPatch = Partial<Omit<IntegrationRecord, "provider">>;

export const publicIntegration = (r: IntegrationRecord): Integration => ({
  provider: r.provider,
  status: r.status,
  account: r.account,
  connected_at: r.connected_at,
  last_sync_at: r.last_sync_at,
  error: r.error,
});

export interface UpsertResult {
  inserted: Event[];
  updated: Event[];
  unchanged: number;
}

// What executing a recommendation changed, so undo can put it back. Stored as jsonb; parsed by
// apps/api/src/actions/calendar.ts. Never returned by the API.
export interface RecommendationActionUpdate {
  status: RecommendationStatus;
  executed_at?: string | null;
  undone_at?: string | null;
  execution?: unknown;
}

export type EventPatch = Partial<Pick<Event, "start_at" | "end_at" | "title" | "data">>;

// JSON with sorted keys, so jsonb's own key order never reads as a change.
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/** True when an upsert would change nothing on the stored event. */
export const sameEvent = (e: Event, i: z.output<typeof EventInput>) =>
  e.type === i.type &&
  e.title === i.title &&
  Date.parse(e.start_at) === Date.parse(i.start_at) &&
  (e.end_at ? Date.parse(e.end_at) : null) === (i.end_at ? Date.parse(i.end_at) : null) &&
  canonical(e.data) === canonical(i.data);

export type NudgeCreate = Omit<Nudge, "id" | "created_at" | "sent_at">;

/** A device that turned nudges on (Web Push). Server side only, never sent to the browser. */
export interface PushDevice {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Storage boundary. Routes and MCP tools depend only on this interface.
// MemoryStore is used when Supabase env vars are missing; SupabaseStore (supabase-store.ts) otherwise.
export interface Store extends PrivacyBackend {
  readonly kind: "memory" | "supabase";
  listEvents(filter: TimelineFilter): Promise<Event[]>;
  insertEvents(events: z.output<typeof EventInput>[]): Promise<InsertResult>;
  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<Goal | null>;
  createGoal(input: z.output<typeof GoalCreate>): Promise<Goal>;
  updateGoal(id: string, patch: z.output<typeof GoalUpdate>): Promise<Goal | null>;
  deleteGoal(id: string): Promise<boolean>;
  // The onboarding answers (routes/profile.ts fills in defaults); null until first saved.
  getProfile(): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<Profile>;
  listRecommendations(filter?: { status?: RecommendationStatus }): Promise<Recommendation[]>;
  updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Recommendation | null>;
  getRecommendation(id: string): Promise<Recommendation | null>;
  /** The execution record saved by `recordRecommendationAction`, or null. */
  getRecommendationExecution(id: string): Promise<unknown>;
  recordRecommendationAction(id: string, update: RecommendationActionUpdate): Promise<Recommendation | null>;
  latestAnalysisRun(): Promise<AnalysisRun | null>;
  // Proposed by Michael's own rules (e.g. travel) or asked for in chat; status starts at proposed.
  createRecommendation(input: NewRecommendation): Promise<Recommendation>;
  // Saved places (home, work, gym). replacePlaces swaps the whole list.
  listPlaces(): Promise<Place[]>;
  replacePlaces(places: Omit<Place, "updated_at">[]): Promise<Place[]>;
  // Geocoding cache, per user, keyed by the normalised query (integrations/maps.ts).
  cachedGeocode(query: string): Promise<GeocodeHit | null>;
  saveGeocode(query: string, hit: GeocodeHit): Promise<void>;
  // Privacy (privacy.ts holds the rules; insertEvents applies them).
  setOffTheRecord(on: boolean): Promise<PrivacyRules>;
  /** The most recent chat messages, oldest first. */
  listChatMessages(limit: number): Promise<ChatMessage[]>;
  addChatMessage(role: ChatRole, content: string): Promise<ChatMessage>;

  // ---- events mirrored from a provider (Google Calendar) ----
  getEvent(id: string): Promise<Event | null>;
  /** Insert or update by (source, external_id); every input must carry an external_id. */
  upsertEvents(events: z.output<typeof EventInput>[]): Promise<UpsertResult>;
  updateEvent(id: string, patch: EventPatch): Promise<Event | null>;
  /** Only for provider mirrors and blocks Michael created; never for the user's own records. */
  deleteEvents(ids: string[]): Promise<number>;

  // ---- integrations (OAuth tokens) ----
  listIntegrations(): Promise<IntegrationRecord[]>;
  getIntegration(provider: IntegrationProvider): Promise<IntegrationRecord | null>;
  saveIntegration(provider: IntegrationProvider, patch: IntegrationPatch): Promise<IntegrationRecord>;
  /** Not scoped to the current user: only the background sync uses it, then acts as each user. */
  listConnectedUserIds(provider: IntegrationProvider): Promise<string[]>;
  /** Nudges created in [from, to), oldest first. */
  listNudges(filter: { from: string; to: string }): Promise<Nudge[]>;
  /** Null when this key was already used on that day (the dedupe guard). */
  createNudge(input: NudgeCreate): Promise<Nudge | null>;
  updateNudgeStatus(id: string, status: NudgeStatus): Promise<Nudge | null>;
  // Web Push devices of the current user.
  listPushDevices(): Promise<PushDevice[]>;
  /** Saves the device for the current user (a device belongs to whoever subscribed it last). */
  savePushDevice(device: PushDevice, userAgent: string | null): Promise<void>;
  removePushDevice(endpoint: string): Promise<void>;
  /**
   * The one read that is NOT scoped to the current user: ids of users with events received since
   * `since`. Only the scheduler calls it, outside any request, and then runs each check as that user.
   */
  activeUserIds(since: string): Promise<string[]>;
}

export const emptyIntegration = (provider: IntegrationProvider): IntegrationRecord => ({
  provider,
  status: "disconnected",
  account: null,
  connected_at: null,
  last_sync_at: null,
  error: null,
  access_token: null,
  refresh_token: null,
  expires_at: null,
  scope: null,
});

const now = () => new Date().toISOString();
const overlaps = (e: Event, from: number, to: number) => {
  const start = Date.parse(e.start_at);
  const end = e.end_at ? Date.parse(e.end_at) : start;
  return start <= to && end >= from;
};

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  // One copy of the mock day per user, created on first access, so users never see each other's data.
  private data = new Map<
    string,
    {
      events: Event[];
      goals: Goal[];
      recommendations: Recommendation[];
      runs: AnalysisRun[];
      privacy: PrivacyRules;
      chat: ChatMessage[];
      integrations: IntegrationRecord[];
      nudges: Nudge[];
      push: PushDevice[];
      executions: Map<string, unknown>;
      places: Place[];
      geocodes: Map<string, GeocodeHit>;
    }
  >();
  private get d() {
    const userId = currentUserId();
    let x = this.data.get(userId);
    if (!x) {
      x = {
        events: structuredClone(mockEvents),
        goals: structuredClone(mockGoals),
        recommendations: structuredClone(mockRecommendations),
        runs: [structuredClone(mockAnalysisRun)],
        privacy: { offTheRecord: false, since: null, sources: {} },
        chat: [],
        integrations: [],
        nudges: [],
        push: [],
        executions: new Map(),
        places: [],
        geocodes: new Map(),
      };
      this.data.set(userId, x);
    }
    return x;
  }
  private get events() {
    return this.d.events;
  }
  private get goals() {
    return this.d.goals;
  }
  private set goals(v: Goal[]) {
    this.d.goals = v;
  }
  private get recommendations() {
    return this.d.recommendations;
  }
  private get runs() {
    return this.d.runs;
  }

  async listEvents(f: TimelineFilter) {
    const from = Date.parse(f.from);
    const to = Date.parse(f.to);
    return this.events
      .filter((e) => overlaps(e, from, to))
      .filter((e) => !f.source || f.source.includes(e.source))
      .filter((e) => !f.type || f.type.includes(e.type))
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  }

  async privacyRules() {
    return structuredClone(this.d.privacy);
  }

  async setOffTheRecord(on: boolean) {
    const p = this.d.privacy;
    if (on !== p.offTheRecord) {
      p.offTheRecord = on;
      p.since = on ? now() : null;
    }
    return structuredClone(p);
  }

  async setSourceEnabled(source: Source, enabled: boolean): Promise<SourceSetting> {
    const setting = { enabled, updated_at: now() };
    this.d.privacy.sources[source] = setting;
    return { source, ...setting };
  }

  async insertEvents(all: z.output<typeof EventInput>[]) {
    const { allowed: inputs, ignored } = await screenEvents(this, all);
    const inserted: Event[] = [];
    let duplicates = 0;
    for (const i of inputs) {
      const ext = i.external_id ?? null;
      if (ext && this.events.some((e) => e.source === i.source && e.external_id === ext)) {
        duplicates++;
        continue;
      }
      const event: Event = {
        id: crypto.randomUUID(),
        source: i.source,
        type: i.type,
        start_at: i.start_at,
        end_at: i.end_at ?? null,
        title: i.title,
        data: i.data,
        external_id: ext,
        created_at: now(),
      };
      this.events.push(event);
      inserted.push(event);
    }
    return { inserted, duplicates, ignored };
  }

  async listGoals() {
    return this.goals;
  }

  async getGoal(id: string) {
    return this.goals.find((g) => g.id === id) ?? null;
  }

  async createGoal(i: z.output<typeof GoalCreate>) {
    const goal: Goal = {
      id: crypto.randomUUID(),
      category: i.category,
      title: i.title,
      description: i.description ?? null,
      target: i.target ?? null,
      weekly_budget_minutes: i.weekly_budget_minutes ?? null,
      active: i.active,
      created_at: now(),
      updated_at: now(),
    };
    this.goals.push(goal);
    return goal;
  }

  async updateGoal(id: string, patch: z.output<typeof GoalUpdate>) {
    const goal = this.goals.find((g) => g.id === id);
    if (!goal) return null;
    Object.assign(goal, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    goal.updated_at = now();
    return goal;
  }

  async deleteGoal(id: string) {
    const before = this.goals.length;
    this.goals = this.goals.filter((g) => g.id !== id);
    return this.goals.length < before;
  }

  private profiles = new Map<string, Profile>();

  async getProfile() {
    return structuredClone(this.profiles.get(currentUserId()) ?? null);
  }

  async saveProfile(profile: Profile) {
    this.profiles.set(currentUserId(), structuredClone(profile));
    return structuredClone(profile);
  }

  async listRecommendations(filter?: { status?: RecommendationStatus }) {
    return this.recommendations.filter((r) => !filter?.status || r.status === filter.status);
  }

  async getRecommendation(id: string) {
    return this.recommendations.find((r) => r.id === id) ?? null;
  }

  async createRecommendation(i: NewRecommendation) {
    const rec: Recommendation = {
      id: crypto.randomUUID(),
      analysis_run_id: i.analysis_run_id ?? null,
      goal_id: i.goal_id,
      title: i.title,
      rationale: i.rationale,
      action: i.action,
      status: "proposed",
      executed_at: null,
      undone_at: null,
      source: i.source ?? "analysis",
      created_at: now(),
      updated_at: now(),
    };
    this.recommendations.push(rec);
    return rec;
  }

  async getRecommendationExecution(id: string) {
    return this.d.executions.get(id) ?? null;
  }

  async recordRecommendationAction(id: string, u: RecommendationActionUpdate) {
    const rec = this.recommendations.find((r) => r.id === id);
    if (!rec) return null;
    rec.status = u.status;
    if (u.executed_at !== undefined) rec.executed_at = u.executed_at;
    if (u.undone_at !== undefined) rec.undone_at = u.undone_at;
    if (u.execution !== undefined) this.d.executions.set(id, u.execution);
    rec.updated_at = now();
    return rec;
  }

  async updateRecommendationStatus(id: string, status: RecommendationStatus) {
    const rec = this.recommendations.find((r) => r.id === id);
    if (!rec) return null;
    rec.status = status;
    rec.updated_at = now();
    return rec;
  }

  async latestAnalysisRun() {
    return this.runs.at(-1) ?? null;
  }

  async listChatMessages(limit: number) {
    return this.d.chat.slice(-limit);
  }

  async addChatMessage(role: ChatRole, content: string) {
    const message: ChatMessage = { id: crypto.randomUUID(), role, content, created_at: now() };
    this.d.chat.push(message);
    return message;
  }

  async getEvent(id: string) {
    return this.events.find((e) => e.id === id) ?? null;
  }

  async upsertEvents(inputs: z.output<typeof EventInput>[]) {
    const result: UpsertResult = { inserted: [], updated: [], unchanged: 0 };
    for (const i of inputs) {
      const found = this.events.find((e) => e.source === i.source && e.external_id === i.external_id);
      if (!found) {
        result.inserted.push(...(await this.insertEvents([i])).inserted);
      } else if (sameEvent(found, i)) {
        result.unchanged++;
      } else {
        Object.assign(found, {
          type: i.type,
          title: i.title,
          start_at: i.start_at,
          end_at: i.end_at ?? null,
        });
        found.data = i.data;
        result.updated.push(found);
      }
    }
    return result;
  }

  async updateEvent(id: string, patch: EventPatch) {
    const e = this.events.find((x) => x.id === id);
    if (!e) return null;
    Object.assign(e, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return e;
  }

  async deleteEvents(ids: string[]) {
    const d = this.d;
    const before = d.events.length;
    d.events = d.events.filter((e) => !ids.includes(e.id));
    return before - d.events.length;
  }

  async listIntegrations() {
    return this.d.integrations;
  }

  async getIntegration(provider: IntegrationProvider) {
    return this.d.integrations.find((i) => i.provider === provider) ?? null;
  }

  async saveIntegration(provider: IntegrationProvider, patch: IntegrationPatch) {
    let rec = this.d.integrations.find((i) => i.provider === provider);
    if (!rec) {
      rec = emptyIntegration(provider);
      this.d.integrations.push(rec);
    }
    Object.assign(rec, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return rec;
  }

  async listConnectedUserIds(provider: IntegrationProvider) {
    return [...this.data.entries()]
      .filter(([, x]) => x.integrations.some((i) => i.provider === provider && i.status === "connected"))
      .map(([userId]) => userId);
  }

  async listNudges(f: { from: string; to: string }) {
    const from = Date.parse(f.from);
    const to = Date.parse(f.to);
    return this.d.nudges.filter((n) => {
      const t = Date.parse(n.created_at);
      return t >= from && t < to;
    });
  }

  async createNudge(i: NudgeCreate) {
    if (this.d.nudges.some((n) => n.day === i.day && n.key === i.key)) return null;
    const nudge: Nudge = { ...i, id: crypto.randomUUID(), created_at: now(), sent_at: null };
    this.d.nudges.push(nudge);
    return nudge;
  }

  async updateNudgeStatus(id: string, status: NudgeStatus) {
    const nudge = this.d.nudges.find((n) => n.id === id);
    if (!nudge) return null;
    nudge.status = status;
    if (status === "sent") nudge.sent_at = now();
    return nudge;
  }

  async listPushDevices() {
    return structuredClone(this.d.push);
  }

  async savePushDevice(device: PushDevice) {
    // The endpoint moves to the current user, as in the database's unique index.
    for (const x of this.data.values()) x.push = x.push.filter((p) => p.endpoint !== device.endpoint);
    this.d.push.push(structuredClone(device));
  }

  async removePushDevice(endpoint: string) {
    this.d.push = this.d.push.filter((p) => p.endpoint !== endpoint);
  }

  async activeUserIds(since: string) {
    const from = Date.parse(since);
    return [...this.data.entries()]
      .filter(([, x]) => x.events.some((e) => Date.parse(e.created_at) >= from))
      .map(([userId]) => userId);
  }

  async listPlaces() {
    return structuredClone(this.d.places);
  }

  async replacePlaces(places: Omit<Place, "updated_at">[]) {
    this.d.places = places
      .map((p) => ({ ...p, updated_at: now() }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return structuredClone(this.d.places);
  }

  async cachedGeocode(query: string) {
    return this.d.geocodes.get(query) ?? null;
  }

  async saveGeocode(query: string, hit: GeocodeHit) {
    this.d.geocodes.set(query, hit);
  }
}

// Supabase when configured (production, or local with keys), otherwise the in-memory mock day.
export const store: Store =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : new MemoryStore();
