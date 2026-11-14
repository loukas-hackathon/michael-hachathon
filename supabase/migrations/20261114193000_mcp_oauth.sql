-- MCP OAuth (claude.ai connector, #93): clients registered by dynamic client registration,
-- authorisation requests and codes, and the access and refresh tokens bound to a user.
-- Only the API (service role) touches these; codes and tokens are stored as sha256 hashes.

create table oauth_clients (
  client_id     text primary key,
  client_name   text not null,
  redirect_uris text[] not null,
  created_at    timestamptz not null default now()
);

create table oauth_grants (
  id             uuid primary key,
  client_id      text not null references oauth_clients (client_id) on delete cascade,
  redirect_uri   text not null,
  state          text,
  code_challenge text not null,
  scopes         text[] not null default '{}',
  resource       text not null,
  -- set when the user allows on the consent page
  user_id        uuid references auth.users (id) on delete cascade,
  code_hash      text unique,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);

create table oauth_tokens (
  id                 uuid primary key,
  client_id          text not null references oauth_clients (client_id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  scopes             text[] not null default '{}',
  resource           text not null,
  access_hash        text not null unique,
  refresh_hash       text not null unique,
  access_expires_at  timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index oauth_tokens_user_id_idx on oauth_tokens (user_id);

alter table oauth_clients enable row level security;
alter table oauth_grants enable row level security;
alter table oauth_tokens enable row level security;
