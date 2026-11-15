-- Separate conversations with Michael (#308). A thread belongs to the user, and on the demo account
-- to one visitor (visitor_id, as on chat_messages since #236; null for the account's own threads).
-- preview and last_message_at are kept by the API on every line, so the list needs one query.
create table if not exists chat_threads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  visitor_id      uuid,
  title           text not null default 'New chat',
  pinned          boolean not null default false,
  archived        boolean not null default false,
  preview         text,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists chat_threads_user_visitor_last_idx
  on chat_threads (user_id, visitor_id, last_message_at desc nulls last);
alter table chat_threads enable row level security;

-- Deleting a thread really deletes its lines.
alter table chat_messages
  add column if not exists thread_id uuid references chat_threads (id) on delete cascade;
create index if not exists chat_messages_thread_created_idx on chat_messages (thread_id, created_at desc);

-- Lines from before threads go into one "Earlier" thread per user and visitor. Nullable on purpose:
-- an API still on the old code during the deploy keeps saving lines; the new code always sets it.
insert into chat_threads (user_id, visitor_id, title, preview, last_message_at, created_at, updated_at)
select
  user_id,
  visitor_id,
  'Earlier',
  left((array_agg(content order by created_at desc))[1], 140),
  max(created_at),
  min(created_at),
  max(created_at)
from chat_messages
where thread_id is null
group by user_id, visitor_id;

update chat_messages m
set thread_id = t.id
from chat_threads t
where m.thread_id is null
  and t.title = 'Earlier'
  and t.user_id = m.user_id
  and t.visitor_id is not distinct from m.visitor_id;
