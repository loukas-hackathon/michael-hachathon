-- Calendar actions (#39): what executing a recommendation changed (the block Michael created, or the
-- original times of a block he moved), so undo can put it back. Internal: never returned by the API.
alter table recommendations add column if not exists execution jsonb;
