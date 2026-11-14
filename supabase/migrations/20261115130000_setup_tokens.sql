-- Setup tokens (#120): short lived, single use, exchanged once for a device key for one connection.
-- They go into QR codes, install commands and downloaded files instead of the long lived key.
-- Only the sha256 is stored. Rows past their expiry are useless and can be deleted at any time.
create table setup_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  connection  text not null check (connection in ('mac', 'apple-watch', 'iphone')),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index setup_tokens_user_idx on setup_tokens (user_id);
alter table setup_tokens enable row level security;
