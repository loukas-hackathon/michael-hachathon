-- Nudge engine (#42): each nudge is tied to a goal, carries the maths behind it, and a dedupe key
-- that never fires twice on one local day. Mirrors Nudge in packages/shared/src/schemas.ts.

alter table nudges add column if not exists goal_id uuid references goals (id) on delete set null;
alter table nudges add column if not exists kind text not null default 'goal_behind'
  check (kind in ('focus_drift', 'block_soon', 'wind_down', 'goal_behind'));
alter table nudges add column if not exists key text;
alter table nudges add column if not exists day date not null default current_date;
alter table nudges add column if not exists reason text not null default '';

update nudges set key = id::text where key is null;
alter table nudges alter column key set not null;

create unique index if not exists nudges_user_day_key on nudges (user_id, day, key);
create index if not exists nudges_user_created_at_idx on nudges (user_id, created_at);
