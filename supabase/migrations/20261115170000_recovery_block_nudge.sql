-- Recovery offers go out as nudges (#167): one more kind. Mirrors NudgeKind in packages/shared.
alter table nudges drop constraint if exists nudges_kind_check;
alter table nudges add constraint nudges_kind_check
  check (kind in ('focus_drift', 'block_soon', 'wind_down', 'goal_behind', 'morning', 'evening', 'recovery_block'));
