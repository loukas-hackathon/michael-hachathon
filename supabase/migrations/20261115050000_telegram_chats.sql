-- Telegram nudges (#43): the chat each user connected with one tap (t.me/<bot>?start=<token>).
-- One row per user. A chat belongs to whoever bound it last, so chat_id is unique. Disconnecting
-- (on You or /stop) clears the chat; last_link stays so a start link only ever works once.
-- Only the API (service role) reads it.
create table if not exists telegram_chats (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  chat_id      text unique,
  username     text,
  connected_at timestamptz,
  last_link    text,
  updated_at   timestamptz not null default now()
);
alter table telegram_chats enable row level security;
