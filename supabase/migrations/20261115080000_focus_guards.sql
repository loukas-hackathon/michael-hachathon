-- Block distracting Mac apps (#41): executing a block_mac_app recommendation creates a focus guard;
-- undo deletes it. The Mac collector reads the running ones (GET /v1/focus-guards/active) and closes
-- the named apps when they come to the front. Mirrors FocusGuard in packages/shared/src/schemas.ts.
create table if not exists focus_guards (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  recommendation_id uuid references recommendations (id) on delete cascade,
  apps              text[] not null check (cardinality(apps) > 0),
  bundle_ids        text[] not null default '{}',
  start_at          timestamptz not null,
  end_at            timestamptz not null check (end_at > start_at),
  goal_id           uuid references goals (id) on delete set null,
  back_to           text,
  created_at        timestamptz not null default now()
);
create index if not exists focus_guards_user_end_idx on focus_guards (user_id, end_at);
alter table focus_guards enable row level security;
