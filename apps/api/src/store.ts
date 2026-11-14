import {
  type AnalysisRun,
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
} from "@michael/shared";
import type { z } from "zod";
import { env } from "./env";
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
  // Dropped by privacy settings (source off / off the record). Enforced in its own issue.
  ignored: number;
}

// Storage boundary. Routes and MCP tools depend only on this interface.
// MemoryStore is used when Supabase env vars are missing; SupabaseStore (supabase-store.ts) otherwise.
export interface Store {
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
}

const now = () => new Date().toISOString();
const overlaps = (e: Event, from: number, to: number) => {
  const start = Date.parse(e.start_at);
  const end = e.end_at ? Date.parse(e.end_at) : start;
  return start <= to && end >= from;
};

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private events: Event[] = structuredClone(mockEvents);
  private goals: Goal[] = structuredClone(mockGoals);
  private recommendations: Recommendation[] = structuredClone(mockRecommendations);
  private runs: AnalysisRun[] = [structuredClone(mockAnalysisRun)];

  async listEvents(f: TimelineFilter) {
    const from = Date.parse(f.from);
    const to = Date.parse(f.to);
    return this.events
      .filter((e) => overlaps(e, from, to))
      .filter((e) => !f.source || f.source.includes(e.source))
      .filter((e) => !f.type || f.type.includes(e.type))
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  }

  async insertEvents(inputs: z.output<typeof EventInput>[]) {
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
    return { inserted, duplicates, ignored: 0 };
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
}

// Supabase when configured (production, or local with keys), otherwise the in-memory mock day.
export const store: Store =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : new MemoryStore();
