-- Traction for investors (GET /v1/admin/traction, admins only). Two cross user reads, for the
-- service role only, that answer per user from per user indexes. Only aggregates of their rows
-- ever leave the API. The API passes the users to count (demo and judges' accounts already left
-- out) and the sources that count as connecting a real source.

-- Active days read events received per user and day.
create index if not exists events_user_created_at_idx on events (user_id, created_at);

create or replace function traction_user_facts(
  users uuid[],
  since timestamptz,
  tz text,
  sources text[],
  seeded_prefix text
)
returns table (
  user_id uuid,
  first_source_at timestamptz,
  active_days text[],
  actions_done integer,
  actions_undone integer,
  chat_messages integer,
  nudges_sent integer
)
language sql
stable
as $$
  select
    u.id,
    -- The first event of a real source (one index probe per source on user, source, created_at),
    -- or the first integration connected, whichever came first. least() skips nulls.
    least(
      (
        select min(f.at) from unnest(sources) as s(name)
        cross join lateral (
          select e.created_at as at
          from events e
          where e.user_id = u.id
            and e.source = s.name::event_source
            and (e.external_id is null or e.external_id not like seeded_prefix || '%')
          order by e.created_at
          limit 1
        ) f
      ),
      (select min(i.connected_at) from integrations i where i.user_id = u.id)
    ),
    coalesce(
      (
        select array_agg(d.day order by d.day)
        from (
          select to_char(e.created_at at time zone tz, 'YYYY-MM-DD') as day
          from events e
          where e.user_id = u.id
            and e.created_at >= since
            and (e.external_id is null or e.external_id not like seeded_prefix || '%')
          union
          select to_char(m.created_at at time zone tz, 'YYYY-MM-DD')
          from chat_messages m
          where m.user_id = u.id and m.created_at >= since and m.role = 'user' and m.visitor_id is null
        ) d
      ),
      '{}'::text[]
    ),
    (select count(*)::int from recommendations r
      where r.user_id = u.id and r.status in ('done', 'undone')),
    (select count(*)::int from recommendations r where r.user_id = u.id and r.status = 'undone'),
    (select count(*)::int from chat_messages m
      where m.user_id = u.id and m.role = 'user' and m.visitor_id is null),
    (select count(*)::int from nudges n where n.user_id = u.id and n.status = 'sent')
  from unnest(users) as u(id)
$$;
revoke all on function traction_user_facts(uuid[], timestamptz, text, text[], text)
  from public, anon, authenticated;

-- Tool calls from connected agents (the claude.ai connector among them), per user, all time.
create or replace function traction_agent_queries(users uuid[])
returns table (user_id uuid, queries integer)
language sql
stable
as $$
  select q.user_id, count(*)::int
  from agent_queries q
  where q.user_id = any(users)
  group by q.user_id
$$;
revoke all on function traction_agent_queries(uuid[]) from public, anon, authenticated;
