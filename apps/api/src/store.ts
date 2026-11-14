import {
  type AnalysisRun,
  type ChatMessage,
  type ChatRole,
  demoRecommendations,
  type Event,
  type EventInput,
  type EventSummary,
  type EventType,
  type Goal,
  type GoalCreate,
  type GoalUpdate,
  type Instruction,
  type InstructionCreate,
  type InstructionUpdate,
  type Integration,
  type IntegrationProvider,
  mockAnalysisRun,
  mockEvents,
  mockGoals,
  mockInstructions,
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
import { stableUuid } from "./demo/week";
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

export interface SeedResult {
  inserted: number;
  removed: number;
  kept: number;
}

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

/** What DELETE /v1/me/data removes: the whole account, or the matching timeline events. */
export interface DataDeleteScope {
  everything: boolean;
  source?: Source;
  from?: string;
  to?: string;
}

/** Rows deleted per table. */
export type DeleteCounts = Record<string, number>;

/** UTC days a summary row must fall in to match a [from, to) range. */
export const summaryDayRange = (from?: string, to?: string) => ({
  from: from ? new Date(from).toISOString().slice(0, 10) : undefined,
  to: to ? new Date(Date.parse(to) - 1).toISOString().slice(0, 10) : undefined,
});

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

/** The Telegram chat a user connected for nudges. Server side only. */
export interface TelegramChat {
  chat_id: string;
  username: string | null;
  connected_at: string;
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
  // ---- standing instructions (the user's ground rules), oldest first ----
  listInstructions(): Promise<Instruction[]>;
  createInstruction(input: z.output<typeof InstructionCreate>): Promise<Instruction>;
  /** A null in the patch clears `days`, `time` or `end_time`; a missing key leaves it alone. */
  updateInstruction(id: string, patch: z.output<typeof InstructionUpdate>): Promise<Instruction | null>;
  deleteInstruction(id: string): Promise<boolean>;
  listRecommendations(filter?: { status?: RecommendationStatus }): Promise<Recommendation[]>;
  updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Recommendation | null>;
  getRecommendation(id: string): Promise<Recommendation | null>;
  /** The execution record saved by `recordRecommendationAction`, or null. */
  getRecommendationExecution(id: string): Promise<unknown>;
  recordRecommendationAction(id: string, update: RecommendationActionUpdate): Promise<Recommendation | null>;
  latestAnalysisRun(): Promise<AnalysisRun | null>;
  /** The questions Michael asked in earlier analysis runs, newest first. */
  listAnalysisQuestions(limit: number): Promise<AskedQuestion[]>;
  /** Stores one finished analysis run and the recommendations it produced (all `proposed`). */
  saveAnalysis(input: NewAnalysis): Promise<{ run: AnalysisRun; recommendations: Recommendation[] }>;
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
  // The Telegram chat of the current user (nudges/telegram.ts), null when none is bound.
  getTelegramChat(): Promise<TelegramChat | null>;
  /**
   * Binds the chat to the current user (a chat belongs to whoever bound it last). `link` is the
   * start token: "used" when that same token already bound a chat once, so each link works once.
   */
  bindTelegramChat(
    chat: { chat_id: string; username: string | null },
    link: string,
  ): Promise<"bound" | "used">;
  /** False when nothing was bound. */
  unbindTelegramChat(): Promise<boolean>;
  /** NOT scoped: the webhook only knows the chat. Whose chat this is, or null. */
  telegramChatOwner(chatId: string): Promise<string | null>;
  /**
   * The one read that is NOT scoped to the current user: ids of users with events received since
   * `since`. Only the scheduler calls it, outside any request, and then runs each check as that user.
   */
  activeUserIds(since: string): Promise<string[]>;

  // Seeding (the demo week, src/demo). Makes the current user's events whose external_id starts
  // with `prefix` and whose source is in `sources` exactly `events`: missing ones are inserted,
  // ones no longer listed are removed. Events without the prefix or of other sources are never
  // touched. No privacy screening here: the caller decides which sources to pass.
  syncSeededEvents(
    prefix: string,
    sources: Source[],
    events: z.output<typeof EventInput>[],
  ): Promise<SeedResult>;
  // Writes goals with their fixed ids. `overwrite: false` only adds the missing ones.
  seedGoals(goals: Goal[], opts: { overwrite: boolean }): Promise<number>;

  // ---- your data: deletion and retention (#47, retention.ts) ----
  /**
   * Really deletes the current user's rows. `everything`: every table that holds the user's data
   * (device keys are deleted by tokens.ts, the auth user by auth.ts). Otherwise only the events and
   * summaries matching source and [from, to).
   */
  deleteMyData(scope: DataDeleteScope): Promise<DeleteCounts>;
  /** The current user's events that started before `before`, oldest first, at most `limit`. */
  listEventsBefore(before: string, limit: number): Promise<Event[]>;
  /** Adds these totals onto the current user's summaries (same day, source, type, category). */
  addEventSummaries(rows: EventSummary[]): Promise<void>;
  listEventSummaries(): Promise<EventSummary[]>;
  /** NOT scoped: users with events that started before `before`. Only the retention job calls it. */
  usersWithEventsBefore(before: string): Promise<string[]>;
}

export interface AskedQuestion {
  question: string;
  asked_at: string;
}

export interface NewAnalysis {
  run: Omit<AnalysisRun, "id">;
  recommendations: Pick<Recommendation, "goal_id" | "title" | "rationale" | "action" | "evidence">[];
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

/** An instruction as the contract has it: `days`, `time` and `end_time` are left out when not set. */
export const toInstruction = (r: {
  id: string;
  text: string;
  kind: Instruction["kind"];
  days?: number[] | null;
  time?: string | null;
  end_time?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}): Instruction => ({
  id: r.id,
  text: r.text,
  kind: r.kind,
  ...(r.days?.length ? { days: [...r.days].sort((a, b) => a - b) } : {}),
  ...(r.time ? { time: r.time } : {}),
  ...(r.end_time ? { end_time: r.end_time } : {}),
  active: r.active,
  created_at: r.created_at,
  updated_at: r.updated_at,
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
  // The demo account starts empty instead: the demo week (src/demo) fills it on its first request.
  private data = new Map<
    string,
    {
      events: Event[];
      goals: Goal[];
      instructions: Instruction[];
      recommendations: Recommendation[];
      runs: AnalysisRun[];
      privacy: PrivacyRules;
      chat: ChatMessage[];
      integrations: IntegrationRecord[];
      nudges: Nudge[];
      push: PushDevice[];
      telegram: (Partial<TelegramChat> & { last_link?: string }) | null;
      executions: Map<string, unknown>;
      places: Place[];
      geocodes: Map<string, GeocodeHit>;
      summaries: EventSummary[];
    }
  >();
  private fresh(sample: boolean) {
    return {
      events: sample ? structuredClone(mockEvents) : [],
      goals: sample ? structuredClone(mockGoals) : [],
      instructions: sample ? structuredClone(mockInstructions) : [],
      recommendations: sample ? [...structuredClone(mockRecommendations), ...demoRecommendations()] : [],
      runs: sample ? [structuredClone(mockAnalysisRun)] : [],
      privacy: { offTheRecord: false, since: null, sources: {} } as PrivacyRules,
      chat: [] as ChatMessage[],
      integrations: [] as IntegrationRecord[],
      nudges: [] as Nudge[],
      push: [] as PushDevice[],
      telegram: null as (Partial<TelegramChat> & { last_link?: string }) | null,
      executions: new Map<string, unknown>(),
      places: [] as Place[],
      geocodes: new Map<string, GeocodeHit>(),
      summaries: [] as EventSummary[],
    };
  }
  private get d() {
    const userId = currentUserId();
    let x = this.data.get(userId);
    if (!x) {
      const demo = userId === env.DEMO_USER_ID && env.DEMO_WEEK === "on";
      x = { ...this.fresh(true), ...(demo ? { events: [], goals: [] } : {}) };
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

  async listInstructions() {
    return this.d.instructions;
  }

  async createInstruction(i: z.output<typeof InstructionCreate>) {
    const instruction = toInstruction({
      id: crypto.randomUUID(),
      ...i,
      created_at: now(),
      updated_at: now(),
    });
    this.d.instructions.push(instruction);
    return instruction;
  }

  async updateInstruction(id: string, patch: z.output<typeof InstructionUpdate>) {
    const list = this.d.instructions;
    const at = list.findIndex((i) => i.id === id);
    const found = list[at];
    if (!found) return null;
    const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const updated = toInstruction({ ...found, ...changes, updated_at: now() });
    list[at] = updated;
    return updated;
  }

  async deleteInstruction(id: string) {
    const d = this.d;
    const before = d.instructions.length;
    d.instructions = d.instructions.filter((i) => i.id !== id);
    return d.instructions.length < before;
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

  async listAnalysisQuestions(limit: number) {
    return this.runs
      .flatMap((r) => (r.question ? [{ question: r.question, asked_at: r.started_at }] : []))
      .reverse()
      .slice(0, limit);
  }

  async saveAnalysis(input: NewAnalysis) {
    const run: AnalysisRun = { id: crypto.randomUUID(), ...input.run };
    this.runs.push(run);
    const at = run.finished_at ?? now();
    const recommendations = input.recommendations.map(
      (r): Recommendation => ({
        id: crypto.randomUUID(),
        analysis_run_id: run.id,
        goal_id: r.goal_id,
        title: r.title,
        rationale: r.rationale,
        action: r.action,
        evidence: r.evidence ?? [],
        status: "proposed",
        executed_at: null,
        undone_at: null,
        created_at: at,
        updated_at: at,
      }),
    );
    this.recommendations.push(...recommendations);
    return { run, recommendations };
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

  async getTelegramChat() {
    const t = this.d.telegram;
    if (!t?.chat_id) return null;
    return { chat_id: t.chat_id, username: t.username ?? null, connected_at: t.connected_at ?? now() };
  }

  async bindTelegramChat(chat: { chat_id: string; username: string | null }, link: string) {
    const d = this.d;
    if (d.telegram?.last_link === link) return "used" as const;
    // The chat moves to the current user, as in the database's unique index.
    for (const x of this.data.values()) {
      if (x !== d && x.telegram?.chat_id === chat.chat_id) x.telegram = { last_link: x.telegram.last_link };
    }
    d.telegram = { ...chat, connected_at: now(), last_link: link };
    return "bound" as const;
  }

  async unbindTelegramChat() {
    const d = this.d;
    if (!d.telegram?.chat_id) return false;
    d.telegram = { last_link: d.telegram.last_link };
    return true;
  }

  async telegramChatOwner(chatId: string) {
    for (const [userId, x] of this.data) if (x.telegram?.chat_id === chatId) return userId;
    return null;
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

  async syncSeededEvents(
    prefix: string,
    sources: Source[],
    inputs: z.output<typeof EventInput>[],
  ): Promise<SeedResult> {
    const key = (e: { source: string; external_id?: string | null }) => `${e.source}|${e.external_id}`;
    const scope = new Set(sources);
    const wanted = new Map(inputs.filter((i) => scope.has(i.source)).map((i) => [key(i), i]));
    const d = this.d;
    let removed = 0;
    const existing = new Set<string>();
    d.events = d.events.filter((e) => {
      if (!e.external_id?.startsWith(prefix) || !scope.has(e.source)) return true;
      if (wanted.has(key(e))) {
        existing.add(key(e));
        return true;
      }
      removed++;
      return false;
    });
    let inserted = 0;
    for (const [k, i] of wanted) {
      if (existing.has(k)) continue;
      d.events.push({
        // Stable ids, so a recommendation pointing at a seeded event survives a reseed.
        id: stableUuid(k),
        source: i.source,
        type: i.type,
        start_at: i.start_at,
        end_at: i.end_at ?? null,
        title: i.title,
        data: i.data,
        external_id: i.external_id ?? null,
        created_at: now(),
      });
      inserted++;
    }
    return { inserted, removed, kept: existing.size };
  }

  async deleteMyData(scope: DataDeleteScope): Promise<DeleteCounts> {
    const d = this.d;
    if (scope.everything) {
      const userId = currentUserId();
      const counts: DeleteCounts = {
        events: d.events.length,
        event_summaries: d.summaries.length,
        goals: d.goals.length,
        recommendations: d.recommendations.length,
        analysis_runs: d.runs.length,
        chat_messages: d.chat.length,
        instructions: d.instructions.length,
        telegram_chats: d.telegram?.chat_id ? 1 : 0,
        nudges: d.nudges.length,
        integrations: d.integrations.length,
        push_subscriptions: d.push.length,
        places: d.places.length,
        geocode_cache: d.geocodes.size,
        source_settings: Object.keys(d.privacy.sources).length,
        privacy_state: d.privacy.offTheRecord || d.privacy.since ? 1 : 0,
        user_profiles: this.profiles.has(userId) ? 1 : 0,
      };
      // An empty account, not the sample day a first visit gets.
      this.data.set(userId, this.fresh(false));
      this.profiles.delete(userId);
      return counts;
    }
    const from = scope.from ? Date.parse(scope.from) : -Infinity;
    const to = scope.to ? Date.parse(scope.to) : Infinity;
    const days = summaryDayRange(scope.from, scope.to);
    const eventHit = (e: Event) => {
      const t = Date.parse(e.start_at);
      return (!scope.source || e.source === scope.source) && t >= from && t < to;
    };
    const summaryHit = (s: EventSummary) =>
      (!scope.source || s.source === scope.source) &&
      (!days.from || s.day >= days.from) &&
      (!days.to || s.day <= days.to);
    const before = { events: d.events.length, event_summaries: d.summaries.length };
    d.events = d.events.filter((e) => !eventHit(e));
    d.summaries = d.summaries.filter((s) => !summaryHit(s));
    return {
      events: before.events - d.events.length,
      event_summaries: before.event_summaries - d.summaries.length,
    };
  }

  async listEventsBefore(before: string, limit: number) {
    const t = Date.parse(before);
    return this.events
      .filter((e) => Date.parse(e.start_at) < t)
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
      .slice(0, limit);
  }

  async addEventSummaries(rows: EventSummary[]) {
    const d = this.d;
    for (const r of rows) {
      const hit = d.summaries.find(
        (s) => s.day === r.day && s.source === r.source && s.type === r.type && s.category === r.category,
      );
      if (hit) {
        hit.events += r.events;
        hit.seconds += r.seconds;
      } else d.summaries.push({ ...r });
    }
  }

  async listEventSummaries() {
    return structuredClone(this.d.summaries).sort((a, b) => a.day.localeCompare(b.day));
  }

  async usersWithEventsBefore(before: string) {
    const t = Date.parse(before);
    return [...this.data.entries()]
      .filter(([, x]) => x.events.some((e) => Date.parse(e.start_at) < t))
      .map(([userId]) => userId);
  }

  async seedGoals(goals: Goal[], opts: { overwrite: boolean }) {
    let written = 0;
    for (const g of goals) {
      const i = this.goals.findIndex((x) => x.id === g.id);
      if (i === -1) this.goals.push(structuredClone(g));
      else if (opts.overwrite) this.goals[i] = structuredClone(g);
      else continue;
      written++;
    }
    return written;
  }
}

// Supabase when configured (production, or local with keys), otherwise the in-memory mock day.
export const store: Store =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : new MemoryStore();
