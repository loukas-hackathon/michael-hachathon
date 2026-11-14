-- The onboarding answers: quiet hours, usual week, weak spots (docs/api.md, Profile).
-- One jsonb document per user, validated by the API against the shared Profile schema.
create table if not exists user_profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table user_profiles enable row level security;
