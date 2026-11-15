-- Meetings mode (#400): conversations are kept only while the user has started it. One row per
-- session: when it started, when it ends by itself (2 hours, or the calendar block's end) and when
-- the user (or off the record) ended it. Ingest checks a conversation's start against these.
-- Mirrors MeetingSession in packages/shared/src/meetings.ts.
create table if not exists meeting_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  ends_at    timestamptz not null check (ends_at > started_at),
  ended_at   timestamptz check (ended_at is null or ended_at >= started_at),
  created_at timestamptz not null default now()
);
create index if not exists meeting_sessions_user_start_idx on meeting_sessions (user_id, started_at desc);

-- RLS: deny all for anon/authenticated; only apps/api (service role) reads and writes.
alter table meeting_sessions enable row level security;
