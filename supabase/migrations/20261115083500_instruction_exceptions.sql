-- Standing instructions get named exceptions (#191): calendar titles allowed inside the time an
-- instruction protects, such as the Sunday recovery session on "Keep Sundays clear". Matched like
-- a goal's calendar_titles (equal or starting with the entry, ignoring case and accents).
-- Mirrors Instruction.exceptions in packages/shared/src/schemas.ts. Null: no exceptions.
alter table instructions add column if not exists exceptions text[];
