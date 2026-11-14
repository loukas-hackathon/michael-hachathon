-- Standing instructions (#131): the user's ground rules, such as "keep Sundays clear" or "home
-- every day by 21:00". Not goals. One row per instruction, scoped to the user like every table.
-- Mirrors Instruction in packages/shared/src/schemas.ts.
create table if not exists instructions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- The user's own words, kept as written.
  text       text not null check (length(text) > 0),
  kind       text not null default 'custom'
             check (kind in ('clear_day', 'home_by', 'quiet_hours', 'custom')),
  -- 0 = Sunday .. 6 = Saturday. Null: every day (home_by, quiet_hours).
  days       smallint[] check (days is null or days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  -- "HH:MM", local time, 24 hour clock.
  "time"     text check ("time" is null or "time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time   text check (end_time is null or end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists instructions_user_created_idx on instructions (user_id, created_at);

drop trigger if exists instructions_updated_at on instructions;
create trigger instructions_updated_at before update on instructions
  for each row execute function set_updated_at();

-- RLS: deny all for anon/authenticated; only apps/api (service role) reads and writes.
alter table instructions enable row level security;
