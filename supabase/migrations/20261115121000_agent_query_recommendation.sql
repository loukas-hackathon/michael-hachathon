-- A change an agent made through Michael (a booked block, a muted app) points at the
-- recommendation that carries it, so the Agents screen can offer Undo next to the log line.
alter table agent_queries
  add column if not exists recommendation_id uuid references recommendations (id) on delete set null;
