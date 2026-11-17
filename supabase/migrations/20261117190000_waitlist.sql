-- The public waiting list (docs/api.md, Waiting list). Not a user's data: the people on it have no
-- account yet. Only the API's service role reads or writes it (RLS on, no policies).
-- Position is computed by the API from created_at and referrals; nothing here stores it.
create table if not exists waitlist (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique check (email = lower(email) and length(email) <= 320),
  name                text not null check (length(name) between 1 and 120),
  role                text not null check (role in ('founder', 'executive', 'employee', 'student', 'other')),
  hours_lost_per_week int not null check (hours_lost_per_week between 0 and 80),
  computer            text not null check (computer in ('mac', 'windows', 'linux')),
  phone               text not null check (phone in ('iphone', 'android')),
  calendar            text not null check (calendar in ('google', 'outlook', 'other')),
  founding_member     boolean not null default false,
  referral_code       text not null unique check (referral_code ~ '^[A-Za-z0-9_-]{4,32}$'),
  referred_by         text references waitlist (referral_code) on delete set null,
  source              text check (length(source) <= 200),
  created_at          timestamptz not null default now(),
  invited_at          timestamptz
);
create index if not exists waitlist_created_idx on waitlist (created_at);
create index if not exists waitlist_referred_by_idx on waitlist (referred_by);
alter table waitlist enable row level security;
