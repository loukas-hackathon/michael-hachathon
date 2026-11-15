-- One round trip reads (#298). PostgREST caps every response at 1000 rows, so a busy week of app
-- and web activity (7,000+ events) took 8 sequential pages of about 100 ms each. These functions
-- return a whole window as ONE json value, which the row cap does not apply to.
-- Only the API calls them, with the service role and the caller's user id from auth.ts (never
-- from a request body); anon and authenticated may not execute them.
-- Purely additive: two functions and their grants. No table, column, index or policy changes.

-- Every event of one user overlapping [p_from, p_to], ordered by (start_at, id) like the paged
-- read: it starts at or before p_to and ends (or, if instant, starts) at or after p_from.
create or replace function events_window(
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_sources text[] default null,
  p_types text[] default null
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    json_agg(
      json_build_object(
        'id', e.id,
        'source', e.source,
        'type', e.type,
        'start_at', e.start_at,
        'end_at', e.end_at,
        'title', e.title,
        'data', e.data,
        'external_id', e.external_id,
        'created_at', e.created_at
      )
      order by e.start_at, e.id
    ),
    '[]'::json
  )
  from events e
  where e.user_id = p_user_id
    and e.start_at <= p_to
    and coalesce(e.end_at, e.start_at) >= p_from
    and (p_sources is null or e.source::text = any (p_sources))
    and (p_types is null or e.type::text = any (p_types))
$$;
revoke all on function events_window(uuid, timestamptz, timestamptz, text[], text[])
  from public, anon, authenticated;
grant execute on function events_window(uuid, timestamptz, timestamptz, text[], text[]) to service_role;

-- The newest event per source for one user (GET /v1/sources/status), one index lookup per source
-- on events_user_source_created_at_idx, all in one round trip: {"iphone_usage": "2026-..."}.
create or replace function last_event_at_by_source(p_user_id uuid)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(json_object_agg(s.source, s.at) filter (where s.at is not null), '{}'::json)
  from (
    select src::text as source,
      (select e.created_at from events e
        where e.user_id = p_user_id and e.source = src
        order by e.created_at desc limit 1) as at
    from unnest(enum_range(null::event_source)) as src
  ) s
$$;
revoke all on function last_event_at_by_source(uuid) from public, anon, authenticated;
grant execute on function last_event_at_by_source(uuid) to service_role;
