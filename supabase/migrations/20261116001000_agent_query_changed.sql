-- What a logged agent call did (#330): true when it changed something, false when a change was
-- tried and nothing changed (not shared, refused by one of Michael's rules, nothing to do), null
-- for a read and for every line from before. The Agents screen counts a change only when it is
-- true, so a refused booking no longer reads as done.
alter table agent_queries
  add column if not exists changed boolean;
