-- Maps and traffic (#115): travel events, saved places, geocoding cache.
-- Mirrors packages/shared/src/schemas.ts (Source "maps", EventType "travel", Place).

alter type event_source add value if not exists 'maps';
alter type event_type add value if not exists 'travel';

-- The user's saved places (home, work, gym). Coordinates stay null until geocoded.
create table if not exists places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null check (key ~ '^[a-z][a-z0-9_]{0,31}$'),
  label      text not null check (length(label) > 0),
  address    text,
  lat        double precision check (lat between -90 and 90),
  lng        double precision check (lng between -180 and 180),
  updated_at timestamptz not null default now()
);
create unique index if not exists places_user_key_key on places (user_id, key);
alter table places enable row level security;

-- Google Geocoding results, per user (calendar locations are personal). Google allows caching
-- coordinates for up to 30 days; the API refetches after that.
create table if not exists geocode_cache (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  query             text not null,
  lat               double precision not null,
  lng               double precision not null,
  formatted_address text not null,
  place_id          text,
  fetched_at        timestamptz not null default now()
);
create unique index if not exists geocode_cache_user_query_key on geocode_cache (user_id, query);
alter table geocode_cache enable row level security;
