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
  mockAnalysisRun,
  mockEvents,
  mockGoals,
  mockRecommendations,
  type Recommendation,
  type RecommendationStatus,
  type Source,
  type SourceSetting,
} from "@michael/shared";
import type { z } from "zod";
import { currentUserId } from "./context";
import { env } from "./env";
import { type PrivacyBackend, type PrivacyRules, screenEvents } from "./privacy";
import { SupabaseStore } from "./supabase-store";

export interface TimelineFilter {
  from: string;
  to: string;
  source?: Source[];
  type?: EventType[];
}

export interface InsertResult {
  inserted: Event[];
  duplicates: number;
  // Dropped by privacy settings (source off / off the record), see privacy.ts.
  ignored: number;
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
  listRecommendations(filter?: { status?: RecommendationStatus }): Promise<Recommendation[]>;
  updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Recommendation | null>;
  latestAnalysisRun(): Promise<AnalysisRun | null>;
  // Privacy (privacy.ts holds the rules; insertEvents applies them).
  setOffTheRecord(on: boolean): Promise<PrivacyRules>;
  /** The most recent chat messages, oldest first. */
  listChatMessages(limit: number): Promise<ChatMessage[]>;
  addChatMessage(role: ChatRole, content: string): Promise<ChatMessage>;
}

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

  async listRecommendations(filter?: { status?: RecommendationStatus }) {
    return this.recommendations.filter((r) => !filter?.status || r.status === filter.status);
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
}

// Supabase when configured (production, or local with keys), otherwise the in-memory mock day.
export const store: Store =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : new MemoryStore();
