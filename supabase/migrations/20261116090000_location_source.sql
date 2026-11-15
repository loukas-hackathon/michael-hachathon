-- Location (#267): place visits from the phone's position and calendar events at saved places.
-- Mirrors packages/shared/src/schemas.ts (Source "location").

alter type event_source add value if not exists 'location';
