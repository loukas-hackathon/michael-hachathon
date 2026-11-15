-- Demo visitors share the demo account but each has a chat of their own. visitor_id is the
-- anonymous id the web app gives one visitor (a random UUID in an httpOnly cookie); null for the
-- account's own chat (signed in users, Claude, scripts). Not a foreign key: visitors have no row.
alter table chat_messages add column if not exists visitor_id uuid;
create index if not exists chat_messages_user_visitor_created_idx
  on chat_messages (user_id, visitor_id, created_at desc);
