-- Personal records (#166): best week overall, best week per category, longest uninterrupted goal
-- block. Computed from score history (apps/api/src/score/records.ts) and stored once.
-- Mirrors PersonalRecord in packages/shared/src/schemas.ts.
create table if not exists records (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  -- One per period and scope ("best_week_area:health:2026-11-09"): a record is created once,
  -- however many times the score is read.
  key            text not null,
  type           text not null check (type in ('best_week', 'best_week_area', 'longest_block')),
  area           text check (area is null or area in ('business', 'health', 'personal')),
  -- longest_block only. No foreign key: the record outlives a deleted goal.
  goal_id        uuid,
  value          integer not null check (value >= 0),
  unit           text not null check (unit in ('pct', 'minutes')),
  -- Null for the first one, a baseline that is never announced.
  previous_value integer check (previous_value is null or previous_value >= 0),
  -- week_start for the week records, the local day for a block.
  achieved_on    date not null,
  event_id       text,
  tick_index     integer check (tick_index is null or tick_index >= 0),
  -- Michael's one line, under 15 words; null for a baseline.
  line           text,
  announced_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (user_id, key)
);
create index if not exists records_user_achieved_idx on records (user_id, achieved_on);

-- RLS: deny all for anon/authenticated; only apps/api (service role) reads and writes.
alter table records enable row level security;
