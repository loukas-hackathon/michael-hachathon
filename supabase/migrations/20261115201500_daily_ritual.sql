-- The daily ritual (#318): morning outcomes, evening log.
-- Checklist items may name the goal they serve (any kind), carry the user's estimate and the
-- minutes logged in the evening, and may be settled as `partly`.
-- Mirrors ChecklistItem and RitualToday in packages/shared/src/schemas.ts.
alter table checklist_items
  add column if not exists linked_goal_id uuid references goals (id) on delete set null,
  add column if not exists estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 1 and 720),
  add column if not exists logged_minutes integer check (logged_minutes is null or logged_minutes between 1 and 720);

alter table checklist_items drop constraint if exists checklist_items_status_check;
alter table checklist_items add constraint checklist_items_status_check
  check (status in ('open', 'done', 'partly', 'dropped', 'moved'));

-- One row per local day and half: the morning or evening saved (`done`, with the evening's line in
-- `summary`) or skipped ("Not today").
create table if not exists day_rituals (
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  kind       text not null check (kind in ('morning', 'evening')),
  state      text not null check (state in ('done', 'skipped')),
  summary    text check (summary is null or char_length(summary) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);

drop trigger if exists day_rituals_updated_at on day_rituals;
create trigger day_rituals_updated_at before update on day_rituals
  for each row execute function set_updated_at();

-- RLS: deny all for anon/authenticated; only apps/api (service role) reads and writes.
alter table day_rituals enable row level security;
