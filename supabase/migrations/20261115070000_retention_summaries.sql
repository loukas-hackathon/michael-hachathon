-- Retention (#47): full detail for 90 days, then daily summaries. The daily job in
-- apps/api/src/retention.ts rolls events older than 90 days into these rows, then deletes the raw
-- events. Only counts and time per UTC day, source, type and category: no titles, no data.
-- Mirrors EventSummary in packages/shared/src/schemas.ts.

create table if not exists event_summaries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  source     event_source not null,
  type       event_type not null,
  category   text not null default '',
  events     integer not null default 0 check (events >= 0),
  seconds    bigint not null default 0 check (seconds >= 0),
  updated_at timestamptz not null default now()
);
create unique index if not exists event_summaries_user_day_key
  on event_summaries (user_id, day, source, type, category);
alter table event_summaries enable row level security;

-- The retention job's one cross user read: whom to roll up. Each roll up then runs scoped as that
-- user (same pattern as active_user_ids).
create or replace function users_with_events_before(before timestamptz)
returns setof uuid
language sql
stable
as $$
  select distinct user_id from events where start_at < before and user_id is not null
$$;
revoke all on function users_with_events_before(timestamptz) from public, anon, authenticated;
