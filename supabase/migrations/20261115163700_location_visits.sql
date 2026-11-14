-- Location (#267): place visits from Mac Wi-Fi and phone positions.
-- Mirrors packages/shared/src/schemas.ts (Source "location", Place.wifi).

alter type event_source add value if not exists 'location';

-- Wi-Fi network ids the user said belong to a place ("This is Home's Wi-Fi").
alter table places add column if not exists wifi text[] not null default '{}';
