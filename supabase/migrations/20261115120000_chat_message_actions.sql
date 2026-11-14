-- What Michael did while writing an answer (recommendation ids, source "chat"), so the Undo chips
-- come back under the same answer after a reload. Empty on the user's own lines.
alter table chat_messages add column if not exists action_ids uuid[] not null default '{}';
