-- Analysis v2 (#20): which specialist (work, training, rest, food) found a recommendation, on runs
-- in mode `specialists`. Null on every other row.
alter table recommendations add column if not exists specialist text
  check (specialist is null or specialist in ('work', 'training', 'rest', 'food'));
