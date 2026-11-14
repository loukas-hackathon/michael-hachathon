-- Michael for agents (#38): every OAuth client a user allows is an agent record (one per user and
-- agent name, so reconnecting Claude updates the same row), and its tokens hang off that record
-- so revoking the agent revokes them.

alter table agent_clients add column if not exists oauth_client_id text
  references oauth_clients (client_id) on delete set null;
create unique index if not exists agent_clients_user_name_key on agent_clients (user_id, lower(name));

alter table oauth_tokens add column if not exists agent_id uuid
  references agent_clients (id) on delete cascade;
create index if not exists oauth_tokens_agent_id_idx on oauth_tokens (agent_id);
alter table oauth_grants add column if not exists agent_id uuid
  references agent_clients (id) on delete cascade;

create index if not exists agent_queries_user_created_at_idx on agent_queries (user_id, created_at desc);
