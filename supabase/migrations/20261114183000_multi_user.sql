-- Every row belongs to one user (Supabase Auth). The API scopes every query by user_id.
-- Existing rows move to the demo account (demo@michael.app), which API-key requests act for.

do $$
declare
  demo uuid := (select id from auth.users where email = 'demo@michael.app');
  t text;
begin
  foreach t in array array[
    'events', 'goals', 'analysis_runs', 'recommendations', 'integrations',
    'source_settings', 'agent_clients', 'agent_queries', 'nudges'
  ] loop
    execute format('alter table %I add column if not exists user_id uuid references auth.users (id) on delete cascade', t);
    if demo is not null then
      execute format('update %I set user_id = $1 where user_id is null', t) using demo;
    end if;
    execute format('create index if not exists %I on %I (user_id)', t || '_user_id_idx', t);
  end loop;
end $$;

-- Idempotent ingest is now per user.
drop index if exists events_source_external_id_key;
create unique index events_user_source_external_id_key on events (user_id, source, external_id)
  where external_id is not null;
create index if not exists events_user_start_at_idx on events (user_id, start_at);

-- Per-user singletons: one integration row per provider, one setting per source, one privacy state.
alter table integrations drop constraint if exists integrations_pkey;
alter table integrations add column if not exists id uuid not null default gen_random_uuid() primary key;
create unique index if not exists integrations_user_provider_key on integrations (user_id, provider);

alter table source_settings drop constraint if exists source_settings_pkey;
alter table source_settings add column if not exists id uuid not null default gen_random_uuid() primary key;
create unique index if not exists source_settings_user_source_key on source_settings (user_id, source);

drop table if exists privacy_state;
create table privacy_state (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  off_the_record boolean not null default false,
  since          timestamptz
);
alter table privacy_state enable row level security;
