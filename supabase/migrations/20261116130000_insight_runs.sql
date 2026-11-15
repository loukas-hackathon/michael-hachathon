-- The insights' discovery pass (docs/api.md, Insights): the tests the model proposed that the
-- server verified, and their words. One jsonb document per user, validated by the API. No
-- figures are kept: every read runs the stored tests again on the user's current data.
create table if not exists insight_runs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table insight_runs enable row level security;
