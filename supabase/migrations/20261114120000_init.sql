-- Michael core schema. Mirrors packages/shared/src/schemas.ts; keep them in sync.
-- Only apps/api talks to the DB (service role). RLS is enabled with no policies,
-- so the anon/authenticated keys can read nothing.

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type event_source as enum (
  'omi', 'whoop', 'health_auto_export', 'ios_shortcuts', 'activitywatch',
  'google_calendar', 'owntracks', 'manual', 'agent'
);
create type event_type as enum (
  'sleep', 'workout', 'recovery', 'biometric', 'app_usage', 'focus_session',
  'conversation', 'memory', 'calendar_event', 'location', 'meal', 'note'
);
create type goal_category as enum ('work', 'gym', 'rest', 'food');
create type recommendation_status as enum ('proposed', 'accepted', 'dismissed', 'done');
create type analysis_status as enum ('queued', 'running', 'succeeded', 'failed');
create type analysis_trigger as enum ('manual', 'scheduled', 'mcp');
create type integration_provider as enum ('google_calendar', 'whoop');
create type integration_status as enum ('connected', 'disconnected', 'error');

-- ---------- timeline ----------
create table events (
  id          uuid primary key default gen_random_uuid(),
  source      event_source not null,
  type        event_type not null,
  start_at    timestamptz not null,
  end_at      timestamptz,
  title       text not null check (length(title) > 0),
  data        jsonb not null default '{}'::jsonb,
  external_id text,
  created_at  timestamptz not null default now(),
  constraint events_end_after_start check (end_at is null or end_at >= start_at)
);
-- Idempotent ingest: one row per provider-side id.
create unique index events_source_external_id_key on events (source, external_id)
  where external_id is not null;
create index events_start_at_idx on events (start_at);
create index events_source_start_at_idx on events (source, start_at);

-- ---------- goals ----------
create table goals (
  id          uuid primary key default gen_random_uuid(),
  category    goal_category not null,
  title       text not null check (length(title) > 0),
  description text,
  target      jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- analysis + recommendations ----------
create table analysis_runs (
  id          uuid primary key default gen_random_uuid(),
  status      analysis_status not null default 'queued',
  trigger     analysis_trigger not null,
  range_start timestamptz not null,
  range_end   timestamptz not null,
  model       text not null,
  summary     text,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index analysis_runs_started_at_idx on analysis_runs (started_at desc);

create table recommendations (
  id              uuid primary key default gen_random_uuid(),
  analysis_run_id uuid references analysis_runs (id) on delete set null,
  goal_id         uuid references goals (id) on delete set null,
  title           text not null check (length(title) > 0),
  rationale       text not null default '',
  -- { kind, payload } or null. Modelled for future execution; not executed in the MVP.
  action          jsonb,
  status          recommendation_status not null default 'proposed',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index recommendations_status_idx on recommendations (status, created_at desc);

-- ---------- integrations (OAuth) ----------
create table integrations (
  provider      integration_provider primary key,
  status        integration_status not null default 'disconnected',
  -- Secrets: never returned by the API.
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  scope         text,
  connected_at  timestamptz,
  last_sync_at  timestamptz,
  error         text,
  updated_at    timestamptz not null default now()
);

-- ---------- updated_at trigger ----------
create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger goals_updated_at before update on goals
  for each row execute function set_updated_at();
create trigger recommendations_updated_at before update on recommendations
  for each row execute function set_updated_at();
create trigger integrations_updated_at before update on integrations
  for each row execute function set_updated_at();

-- ---------- RLS: deny all for anon/authenticated; service role bypasses ----------
alter table events enable row level security;
alter table goals enable row level security;
alter table analysis_runs enable row level security;
alter table recommendations enable row level security;
alter table integrations enable row level security;
