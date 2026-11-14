-- GET /v1/sources/status reads the newest event per source for one user (the Connections rows on
-- You: "Last data 12 min ago"). One small index keeps each of those lookups to a single row.
create index if not exists events_user_source_created_at_idx
  on events (user_id, source, created_at desc);
