-- Weekly targets (#165): next week's score target with the maths, the category floors and who set
-- it. One row per user and Monday. A proposal is not stored until it is accepted or edited.
-- Mirrors WeeklyTarget in packages/shared/src/schemas.ts.
create table if not exists weekly_targets (
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Monday, Europe/Athens.
  week_start  date not null check (extract(isodow from week_start) = 1),
  overall_pct smallint not null check (overall_pct between 0 and 100),
  -- { business, health, personal }: a target per category, null when it has no time goals.
  areas       jsonb not null,
  -- { business, health, personal }: the floor per category, default 50 each.
  floors      jsonb not null,
  status      text not null default 'accepted' check (status in ('proposed', 'accepted')),
  set_by      text not null check (set_by in ('michael', 'user')),
  -- One line in Michael's voice, with the maths.
  reason      text not null default '',
  -- How the proposal was reached: weeks_used, median_pct, step, on_target_weeks, heavy_week.
  basis       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, week_start)
);

drop trigger if exists weekly_targets_updated_at on weekly_targets;
create trigger weekly_targets_updated_at before update on weekly_targets
  for each row execute function set_updated_at();

-- RLS: deny all for anon/authenticated; only apps/api (service role) reads and writes.
alter table weekly_targets enable row level security;
