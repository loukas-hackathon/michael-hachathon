-- Checklist items (#238): the day's one to three outcomes of a goal of kind `checklist`, in the
-- user's own words. Michael never ticks one himself; the user does, or the evening check in.
-- Mirrors ChecklistItem in packages/shared/src/schemas.ts.
create table if not exists checklist_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  goal_id      uuid not null references goals (id) on delete cascade,
  -- The local day, Europe/Athens.
  date         date not null,
  text         text not null check (char_length(text) between 1 and 200),
  -- The slot among the day's open items of the goal: at most three open at once.
  position     smallint not null check (position between 0 and 2),
  status       text not null default 'open' check (status in ('open', 'done', 'dropped', 'moved')),
  settled_at   timestamptz,
  settled_by   text check (settled_by is null or settled_by in ('user', 'check_in')),
  -- The item of the day before that this one continues (carried to the next day).
  carried_from uuid references checklist_items (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists checklist_items_user_date_idx on checklist_items (user_id, date);
-- Two open items never share a slot, so a goal never has more than three open on one day.
create unique index if not exists checklist_items_open_slot_idx
  on checklist_items (user_id, goal_id, date, position) where status = 'open';

drop trigger if exists checklist_items_updated_at on checklist_items;
create trigger checklist_items_updated_at before update on checklist_items
  for each row execute function set_updated_at();

-- RLS: deny all for anon/authenticated; only apps/api (service role) reads and writes.
alter table checklist_items enable row level security;
