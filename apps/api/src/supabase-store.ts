import type {
  AnalysisRun,
  Event,
  EventInput,
  Goal,
  GoalCreate,
  GoalUpdate,
  Recommendation,
  RecommendationStatus,
  Source,
  SourceSetting,
} from "@michael/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { currentUserId } from "./context";
import { HttpError } from "./http";
import { type PrivacyRules, screenEvents } from "./privacy";
import type { InsertResult, Store, TimelineFilter } from "./store";

type EventRow = z.output<typeof EventInput>;

// Postgres returns "2026-11-14 07:40:00+00" style values via PostgREST as ISO strings with offset,
// which already satisfy the shared IsoDateTime schema; normalise to a canonical ISO string anyway.
const iso = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString());

const toEvent = (r: Record<string, unknown>): Event => ({
  id: r.id as string,
  source: r.source as Event["source"],
  type: r.type as Event["type"],
  start_at: iso(r.start_at as string) as string,
  end_at: iso(r.end_at as string | null),
  title: r.title as string,
  data: (r.data as Record<string, unknown>) ?? {},
  external_id: (r.external_id as string | null) ?? null,
  created_at: iso(r.created_at as string) as string,
});

const toGoal = (r: Record<string, unknown>): Goal => ({
  id: r.id as string,
  category: r.category as Goal["category"],
  title: r.title as string,
  description: (r.description as string | null) ?? null,
  target: (r.target as Record<string, unknown> | null) ?? null,
  weekly_budget_minutes: (r.weekly_budget_minutes as number | null) ?? null,
  active: r.active as boolean,
  created_at: iso(r.created_at as string) as string,
  updated_at: iso(r.updated_at as string) as string,
});

const toRecommendation = (r: Record<string, unknown>): Recommendation => ({
  id: r.id as string,
  analysis_run_id: (r.analysis_run_id as string | null) ?? null,
  goal_id: (r.goal_id as string | null) ?? null,
  title: r.title as string,
  rationale: (r.rationale as string) ?? "",
  action: (r.action as Recommendation["action"]) ?? null,
  status: r.status as RecommendationStatus,
  executed_at: iso(r.executed_at as string | null),
  undone_at: iso(r.undone_at as string | null),
  created_at: iso(r.created_at as string) as string,
  updated_at: iso(r.updated_at as string) as string,
});

const toRun = (r: Record<string, unknown>): AnalysisRun => ({
  id: r.id as string,
  status: r.status as AnalysisRun["status"],
  trigger: r.trigger as AnalysisRun["trigger"],
  range_start: iso(r.range_start as string) as string,
  range_end: iso(r.range_end as string) as string,
  model: r.model as string,
  summary: (r.summary as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  started_at: iso(r.started_at as string) as string,
  finished_at: iso(r.finished_at as string | null),
});

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new HttpError("upstream_error", `Database error: ${res.error.message}`);
  return res.data;
}

const withoutUndefined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async listEvents(f: TimelineFilter) {
    // Overlap with [from, to]: starts before `to` and ends (or, if instant, starts) after `from`.
    let q = this.db
      .from("events")
      .select("*")
      .eq("user_id", currentUserId())
      .lte("start_at", f.to)
      .or(`end_at.gte.${f.from},and(end_at.is.null,start_at.gte.${f.from})`)
      .order("start_at", { ascending: true })
      .limit(5000);
    if (f.source?.length) q = q.in("source", f.source);
    if (f.type?.length) q = q.in("type", f.type);
    return (check(await q) ?? []).map(toEvent);
  }

  async privacyRules(): Promise<PrivacyRules> {
    const userId = currentUserId();
    const [state, settings] = await Promise.all([
      this.db.from("privacy_state").select("off_the_record, since").eq("user_id", userId).maybeSingle(),
      this.db.from("source_settings").select("source, enabled, updated_at").eq("user_id", userId),
    ]);
    const s = check(state);
    const rules: PrivacyRules = {
      offTheRecord: s?.off_the_record ?? false,
      since: iso(s?.since ?? null),
      sources: {},
    };
    for (const r of check(settings) ?? []) {
      rules.sources[r.source as Source] = {
        enabled: r.enabled as boolean,
        updated_at: iso(r.updated_at as string) as string,
      };
    }
    return rules;
  }

  async setOffTheRecord(on: boolean) {
    const current = await this.privacyRules();
    // Keep `since` when the switch is pressed twice, so it still says when collection stopped.
    if (current.offTheRecord !== on) {
      const since = on ? new Date().toISOString() : null;
      check(
        await this.db
          .from("privacy_state")
          .upsert({ user_id: currentUserId(), off_the_record: on, since }, { onConflict: "user_id" }),
      );
      current.offTheRecord = on;
      current.since = since;
    }
    return current;
  }

  async setSourceEnabled(source: Source, enabled: boolean): Promise<SourceSetting> {
    const row = check(
      await this.db
        .from("source_settings")
        .upsert(
          { user_id: currentUserId(), source, enabled, updated_at: new Date().toISOString() },
          { onConflict: "user_id,source" },
        )
        .select("source, enabled, updated_at")
        .single(),
    ) as { source: Source; enabled: boolean; updated_at: string };
    return { source: row.source, enabled: row.enabled, updated_at: iso(row.updated_at) as string };
  }

  async insertEvents(all: EventRow[]): Promise<InsertResult> {
    const { allowed: inputs, ignored } = await screenEvents(this, all);
    if (!inputs.length) return { inserted: [], duplicates: 0, ignored };
    const userId = currentUserId();
    const rows = inputs.map((i) => ({
      user_id: userId,
      source: i.source,
      type: i.type,
      start_at: i.start_at,
      end_at: i.end_at ?? null,
      title: i.title,
      data: i.data,
      external_id: i.external_id ?? null,
    }));

    // Idempotency: (source, external_id) is unique where external_id is set. The index is partial,
    // so PostgREST upsert can't target it; filter known ids first, then insert the rest.
    const withExt = rows.filter((r) => r.external_id);
    const known = new Set<string>();
    if (withExt.length) {
      const existing = check(
        await this.db
          .from("events")
          .select("source, external_id")
          .eq("user_id", userId)
          .in(
            "external_id",
            withExt.map((r) => r.external_id as string),
          ),
      );
      for (const e of existing ?? []) known.add(`${e.source}|${e.external_id}`);
    }
    const seen = new Set<string>();
    const fresh = rows.filter((r) => {
      if (!r.external_id) return true;
      const k = `${r.source}|${r.external_id}`;
      if (known.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    let duplicates = rows.length - fresh.length;
    if (!fresh.length) return { inserted: [], duplicates, ignored };

    const res = await this.db.from("events").insert(fresh).select("*");
    if (!res.error) return { inserted: (res.data ?? []).map(toEvent), duplicates, ignored };
    if (res.error.code !== "23505") check(res);

    // A concurrent insert won a race on some external_id: fall back to row by row.
    const inserted: Event[] = [];
    for (const row of fresh) {
      const one = await this.db.from("events").insert(row).select("*").single();
      if (one.error?.code === "23505") duplicates++;
      else inserted.push(toEvent(check(one)));
    }
    return { inserted, duplicates, ignored };
  }

  async listGoals() {
    return (
      check(await this.db.from("goals").select("*").eq("user_id", currentUserId()).order("created_at")) ?? []
    ).map(toGoal);
  }

  async getGoal(id: string) {
    const row = check(
      await this.db.from("goals").select("*").eq("user_id", currentUserId()).eq("id", id).maybeSingle(),
    );
    return row ? toGoal(row) : null;
  }

  async createGoal(i: z.output<typeof GoalCreate>) {
    const row = check(
      await this.db
        .from("goals")
        .insert({
          user_id: currentUserId(),
          category: i.category,
          title: i.title,
          description: i.description ?? null,
          target: i.target ?? null,
          weekly_budget_minutes: i.weekly_budget_minutes ?? null,
          active: i.active,
        })
        .select("*")
        .single(),
    );
    return toGoal(row);
  }

  async updateGoal(id: string, patch: z.output<typeof GoalUpdate>) {
    const row = check(
      await this.db
        .from("goals")
        .update(withoutUndefined(patch as Record<string, unknown>))
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toGoal(row) : null;
  }

  async deleteGoal(id: string) {
    const rows = check(
      await this.db.from("goals").delete().eq("user_id", currentUserId()).eq("id", id).select("id"),
    );
    return (rows ?? []).length > 0;
  }

  async listRecommendations(filter?: { status?: RecommendationStatus }) {
    let q = this.db
      .from("recommendations")
      .select("*")
      .eq("user_id", currentUserId())
      .order("created_at", { ascending: false });
    if (filter?.status) q = q.eq("status", filter.status);
    return (check(await q) ?? []).map(toRecommendation);
  }

  async updateRecommendationStatus(id: string, status: RecommendationStatus) {
    const row = check(
      await this.db
        .from("recommendations")
        .update({ status })
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toRecommendation(row) : null;
  }

  async latestAnalysisRun() {
    const row = check(
      await this.db
        .from("analysis_runs")
        .select("*")
        .eq("user_id", currentUserId())
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    return row ? toRun(row) : null;
  }
}
