-- Analysis (#17): what Michael's answer carries beyond the summary.
--   analysis_runs.question     one short question about a missing fact, usually null
--   recommendations.evidence   names of the patterns that support the recommendation
alter table analysis_runs add column if not exists question text;
alter table recommendations add column if not exists evidence jsonb not null default '[]'::jsonb;
