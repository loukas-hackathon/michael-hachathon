-- Focus now (#397): one tap turns an intention into protected time. A session holds the user's own
-- block from now, an optional focus guard on the Mac, and what was counted when it stopped. The
-- state lives here so the phone can leave the app and come back to the same countdown. One active
-- session per user (per demo visitor on the demo account). Mirrors FocusSession in
-- packages/shared/src/schemas.ts.
create table if not exists focus_sessions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  visitor_id              uuid,
  goal_id                 uuid not null references goals (id) on delete cascade,
  status                  text not null default 'active' check (status in ('active', 'done', 'ended')),
  start_at                timestamptz not null,
  end_at                  timestamptz not null check (end_at > start_at),
  ended_at                timestamptz,
  counted_minutes         integer check (counted_minutes >= 0),
  event_id                uuid,
  owns_block              boolean not null default false,
  block_recommendation_id uuid references recommendations (id) on delete set null,
  guard_recommendation_ids uuid[] not null default '{}',
  apps                    text[] not null default '{}',
  log_recommendation_id   uuid references recommendations (id) on delete set null,
  message                 text,
  created_at              timestamptz not null default now()
);
create unique index if not exists focus_sessions_one_active_idx
  on focus_sessions (user_id, coalesce(visitor_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';
create index if not exists focus_sessions_due_idx on focus_sessions (end_at) where status = 'active';
create index if not exists focus_sessions_user_created_idx on focus_sessions (user_id, created_at desc);
alter table focus_sessions enable row level security;

-- The watch buzz at the end of a session is one more nudge kind. Mirrors NudgeKind.
alter table nudges drop constraint if exists nudges_kind_check;
alter table nudges add constraint nudges_kind_check
  check (kind in ('focus_drift', 'block_soon', 'wind_down', 'goal_behind', 'morning', 'evening', 'recovery_block', 'focus_done'));
