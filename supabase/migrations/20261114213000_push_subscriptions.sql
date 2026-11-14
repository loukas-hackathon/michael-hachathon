-- Web Push (#44): one row per device that turned nudges on. A device belongs to whoever
-- subscribed it last, so the endpoint is unique across users. Only the API (service role) reads it.
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_id_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;

-- Scheduler (#18): users with events received since `since`. The one cross user read, used only
-- to decide whom to run the nudge check for; each check then runs scoped as that user.
create or replace function active_user_ids(since timestamptz)
returns setof uuid
language sql
stable
as $$
  select distinct user_id from events where created_at >= since and user_id is not null
$$;
revoke all on function active_user_ids(timestamptz) from public, anon, authenticated;
