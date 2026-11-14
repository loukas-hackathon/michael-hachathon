import type {
  AnalysisRun,
  ChatMessage,
  ChatRole,
  Event,
  EventInput,
  Goal,
  GoalCreate,
  GoalUpdate,
  IntegrationProvider,
  Nudge,
  NudgeStatus,
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
import {
  type EventPatch,
  type InsertResult,
  type IntegrationPatch,
  type IntegrationRecord,
  type NudgeCreate,
  type PushDevice,
  type RecommendationActionUpdate,
  type Store,
  sameEvent,
  type TimelineFilter,
  type UpsertResult,
} from "./store";

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

const toChatMessage = (r: Record<string, unknown>): ChatMessage => ({
  id: r.id as string,
  role: r.role as ChatRole,
  content: r.content as string,
  created_at: iso(r.created_at as string) as string,
});

const toIntegration = (r: Record<string, unknown>): IntegrationRecord => ({
  provider: r.provider as IntegrationRecord["provider"],
  status: r.status as IntegrationRecord["status"],
  account: (r.account as string | null) ?? null,
  connected_at: iso(r.connected_at as string | null),
  last_sync_at: iso(r.last_sync_at as string | null),
  error: (r.error as string | null) ?? null,
  access_token: (r.access_token as string | null) ?? null,
  refresh_token: (r.refresh_token as string | null) ?? null,
  expires_at: iso(r.expires_at as string | null),
  scope: (r.scope as string | null) ?? null,
});

const toNudge = (r: Record<string, unknown>): Nudge => ({
  id: r.id as string,
  recommendation_id: (r.recommendation_id as string | null) ?? null,
  goal_id: (r.goal_id as string | null) ?? null,
  kind: r.kind as Nudge["kind"],
  key: (r.key as string | null) ?? "",
  day: r.day as string,
  channel: r.channel as Nudge["channel"],
  text: r.text as string,
  reason: (r.reason as string | null) ?? "",
  status: r.status as NudgeStatus,
  created_at: iso(r.created_at as string) as string,
  sent_at: iso(r.sent_at as string | null),
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

  async getRecommendation(id: string) {
    const row = check(
      await this.db
        .from("recommendations")
        .select("*")
        .eq("user_id", currentUserId())
        .eq("id", id)
        .maybeSingle(),
    );
    return row ? toRecommendation(row) : null;
  }

  async getRecommendationExecution(id: string) {
    const row = check(
      await this.db
        .from("recommendations")
        .select("execution")
        .eq("user_id", currentUserId())
        .eq("id", id)
        .maybeSingle(),
    );
    return (row?.execution as unknown) ?? null;
  }

  async recordRecommendationAction(id: string, u: RecommendationActionUpdate) {
    const row = check(
      await this.db
        .from("recommendations")
        .update(withoutUndefined({ ...u }))
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toRecommendation(row) : null;
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

  async listChatMessages(limit: number) {
    const rows = check(
      await this.db
        .from("chat_messages")
        .select("*")
        .eq("user_id", currentUserId())
        .order("created_at", { ascending: false })
        .limit(limit),
    );
    return (rows ?? []).map(toChatMessage).reverse();
  }

  async addChatMessage(role: ChatRole, content: string) {
    const row = check(
      await this.db
        .from("chat_messages")
        .insert({ user_id: currentUserId(), role, content })
        .select("*")
        .single(),
    );
    return toChatMessage(row);
  }

  async getEvent(id: string) {
    const row = check(
      await this.db.from("events").select("*").eq("user_id", currentUserId()).eq("id", id).maybeSingle(),
    );
    return row ? toEvent(row) : null;
  }

  async upsertEvents(inputs: EventRow[]): Promise<UpsertResult> {
    const result: UpsertResult = { inserted: [], updated: [], unchanged: 0 };
    if (!inputs.length) return result;
    const userId = currentUserId();
    const existing = new Map<string, Event>();
    // Chunked so the `in` list stays well inside URL limits.
    for (let i = 0; i < inputs.length; i += 200) {
      const chunk = inputs.slice(i, i + 200);
      const rows = check(
        await this.db
          .from("events")
          .select("*")
          .eq("user_id", userId)
          .in("source", [...new Set(chunk.map((x) => x.source))])
          .in(
            "external_id",
            chunk.map((x) => x.external_id as string),
          ),
      );
      for (const r of rows ?? []) {
        const e = toEvent(r);
        existing.set(`${e.source}|${e.external_id}`, e);
      }
    }
    const fresh: EventRow[] = [];
    for (const i of inputs) {
      const found = existing.get(`${i.source}|${i.external_id}`);
      if (!found) fresh.push(i);
      else if (sameEvent(found, i)) result.unchanged++;
      else {
        const row = check(
          await this.db
            .from("events")
            .update({
              type: i.type,
              title: i.title,
              start_at: i.start_at,
              end_at: i.end_at ?? null,
              data: i.data,
            })
            .eq("user_id", userId)
            .eq("id", found.id)
            .select("*")
            .single(),
        );
        result.updated.push(toEvent(row));
      }
    }
    result.inserted = (await this.insertEvents(fresh)).inserted;
    return result;
  }

  async updateEvent(id: string, patch: EventPatch) {
    const row = check(
      await this.db
        .from("events")
        .update(withoutUndefined(patch as Record<string, unknown>))
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toEvent(row) : null;
  }

  async deleteEvents(ids: string[]) {
    if (!ids.length) return 0;
    const rows = check(
      await this.db.from("events").delete().eq("user_id", currentUserId()).in("id", ids).select("id"),
    );
    return (rows ?? []).length;
  }

  async listIntegrations() {
    return (check(await this.db.from("integrations").select("*").eq("user_id", currentUserId())) ?? []).map(
      toIntegration,
    );
  }

  async getIntegration(provider: IntegrationProvider) {
    const row = check(
      await this.db
        .from("integrations")
        .select("*")
        .eq("user_id", currentUserId())
        .eq("provider", provider)
        .maybeSingle(),
    );
    return row ? toIntegration(row) : null;
  }

  async saveIntegration(provider: IntegrationProvider, patch: IntegrationPatch) {
    const row = check(
      await this.db
        .from("integrations")
        .upsert(
          { user_id: currentUserId(), provider, ...withoutUndefined(patch as Record<string, unknown>) },
          { onConflict: "user_id,provider" },
        )
        .select("*")
        .single(),
    );
    return toIntegration(row);
  }

  async listConnectedUserIds(provider: IntegrationProvider) {
    const rows = check(
      await this.db.from("integrations").select("user_id").eq("provider", provider).eq("status", "connected"),
    );
    return (rows ?? []).map((r) => r.user_id as string).filter(Boolean);
  }

  async listNudges(f: { from: string; to: string }) {
    const rows = check(
      await this.db
        .from("nudges")
        .select("*")
        .eq("user_id", currentUserId())
        .gte("created_at", f.from)
        .lt("created_at", f.to)
        .order("created_at", { ascending: true }),
    );
    return (rows ?? []).map(toNudge);
  }

  async createNudge(i: NudgeCreate) {
    const res = await this.db
      .from("nudges")
      .insert({ ...i, user_id: currentUserId() })
      .select("*")
      .single();
    // Unique (user_id, day, key): another check got there first.
    if (res.error?.code === "23505") return null;
    return toNudge(check(res));
  }

  async updateNudgeStatus(id: string, status: NudgeStatus) {
    const row = check(
      await this.db
        .from("nudges")
        .update({ status, ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}) })
        .eq("user_id", currentUserId())
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    return row ? toNudge(row) : null;
  }

  async listPushDevices(): Promise<PushDevice[]> {
    const rows = check(
      await this.db
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", currentUserId()),
    );
    return (rows ?? []).map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
  }

  async savePushDevice(device: PushDevice, userAgent: string | null) {
    check(
      await this.db.from("push_subscriptions").upsert(
        {
          user_id: currentUserId(),
          endpoint: device.endpoint,
          p256dh: device.keys.p256dh,
          auth: device.keys.auth,
          user_agent: userAgent,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      ),
    );
  }

  async removePushDevice(endpoint: string) {
    check(
      await this.db
        .from("push_subscriptions")
        .delete()
        .eq("user_id", currentUserId())
        .eq("endpoint", endpoint),
    );
  }

  async activeUserIds(since: string) {
    const rows = check(await this.db.rpc("active_user_ids", { since }));
    return ((rows ?? []) as unknown[]).map((r) =>
      typeof r === "string" ? r : String((r as Record<string, unknown>).active_user_ids),
    );
  }
}
