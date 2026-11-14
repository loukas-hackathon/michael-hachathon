-- Morning and Evening moments go out as nudges (#137): two more kinds, once each a day (the key is
-- the kind, so the unique (user_id, day, key) index keeps them to one). Mirrors NudgeKind.

alter table nudges drop constraint if exists nudges_kind_check;
alter table nudges add constraint nudges_kind_check
  check (kind in ('focus_drift', 'block_soon', 'wind_down', 'goal_behind', 'morning', 'evening'));
