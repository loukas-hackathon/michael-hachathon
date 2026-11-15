-- Follow up drafts (#40): short messages Michael writes after a conversation or a meeting with
-- other people, for the user to copy and send themselves. Never sent by Michael. Only the draft is
-- kept, never a transcript. One draft per event, so generating twice never duplicates.
create table if not exists drafts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- The timeline event it follows up. No foreign key: a reseeded or deleted event must not take
  -- the draft with it, and the draft never needs the event to be read.
  event_id          uuid,
  recommendation_id uuid references recommendations (id) on delete set null,
  title             text not null,
  event_at          timestamptz,
  channel           text not null check (channel in ('email', 'chat')),
  subject           text,
  body              text not null,
  written_by        text not null check (written_by in ('model', 'template', 'analysis')),
  status            text not null default 'proposed' check (status in ('proposed', 'done', 'dismissed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists drafts_user_event_idx on drafts (user_id, event_id) where event_id is not null;
create index if not exists drafts_user_created_idx on drafts (user_id, created_at desc);
alter table drafts enable row level security;
