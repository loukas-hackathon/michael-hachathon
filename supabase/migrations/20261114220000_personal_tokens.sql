-- Personal tokens: each acts for one user (collectors, webhooks, the Claude connector).
-- Only the sha256 of the secret is stored; the secret is shown once at creation.
create table personal_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null check (length(name) > 0),
  prefix       text not null,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index personal_tokens_user_idx on personal_tokens (user_id);
alter table personal_tokens enable row level security;
