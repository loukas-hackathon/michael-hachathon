-- Typed chat with Michael (POST /v1/chat). One row per line, scoped to the user like every table.
create table if not exists chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_user_created_idx on chat_messages (user_id, created_at desc);
alter table chat_messages enable row level security;
