-- Build Hub decisions (14 Nov): weekly goal budgets, executable actions with undo, privacy
-- switches, Michael for agents, nudges. Mirrors packages/shared/src/schemas.ts.

-- ---------- enums ----------
alter type recommendation_status add value if not exists 'undone';
alter type analysis_trigger add value if not exists 'morning';
alter type analysis_trigger add value if not exists 'evening';

create type agent_status as enum ('pending', 'approved', 'revoked');
create type nudge_channel as enum ('watch', 'push', 'telegram');
create type nudge_status as enum ('queued', 'sent', 'failed', 'suppressed');

-- ---------- goals: weekly time budget ----------
alter table goals add column weekly_budget_minutes integer check (weekly_budget_minutes >= 0);

-- ---------- recommendations: action lifecycle ----------
-- action jsonb now also carries { involves_others: boolean, undo_until: timestamptz | null }.
alter table recommendations
  add column executed_at timestamptz,
  add column undone_at timestamptz;

-- ---------- privacy ----------
create table source_settings (
  source     event_source primary key,
  enabled    boolean not null default false, -- explicit opt-in per source
  updated_at timestamptz not null default now()
);

-- Single row: one tap stops all collection.
create table privacy_state (
  id             boolean primary key default true check (id),
  off_the_record boolean not null default false,
  since          timestamptz
);
insert into privacy_state (id) values (true);

-- ---------- Michael for agents ----------
create table agent_clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(name) > 0),
  status       agent_status not null default 'pending',
  scopes       text[] not null default '{}',
  -- sha256 of the agent's token; the token itself is never stored.
  token_hash   text unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create table agent_queries (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references agent_clients (id) on delete cascade,
  tool       text not null,
  summary    text not null default '',
  allowed    boolean not null,
  created_at timestamptz not null default now()
);
create index agent_queries_created_at_idx on agent_queries (created_at desc);

-- ---------- nudges ----------
create table nudges (
  id                uuid primary key default gen_random_uuid(),
  recommendation_id uuid references recommendations (id) on delete set null,
  channel           nudge_channel not null,
  text              text not null check (length(text) > 0),
  status            nudge_status not null default 'queued',
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);
create index nudges_created_at_idx on nudges (created_at desc);

create trigger source_settings_updated_at before update on source_settings
  for each row execute function set_updated_at();

alter table source_settings enable row level security;
alter table privacy_state enable row level security;
alter table agent_clients enable row level security;
alter table agent_queries enable row level security;
alter table nudges enable row level security;
