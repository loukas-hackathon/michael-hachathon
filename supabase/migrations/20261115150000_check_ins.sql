-- Chat check in (#187): Michael's questions about the day, drawn from the timeline, and the user's
-- answers as structured notes. They feed the chat context, the analysis brief and later questions
-- (an unaccounted stretch answered "a meeting" is labelled `meeting`). Mirrors CheckIn in
-- packages/shared/src/schemas.ts. Answers about sleep, energy and training are health data: the
-- user can delete any row (DELETE /v1/check-in/:id), and "delete everything" deletes them all.
create table if not exists check_ins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- Stable per user: the same question is never stored twice ("missed:<event id>").
  key           text not null,
  day           date not null,
  kind          text not null
    check (kind in ('missed_block', 'unaccounted', 'training', 'meeting', 'short_night', 'follow_up')),
  question      text not null,
  answer_type   text not null check (answer_type in ('yes_no', 'scale', 'text')),
  moment        text not null check (moment in ('missed_block', 'evening')),
  event_id      uuid references events (id) on delete set null,
  goal_id       uuid references goals (id) on delete set null,
  start_at      timestamptz,
  end_at        timestamptz,
  follow_up_of  uuid references check_ins (id) on delete cascade,
  answer        jsonb,
  label         text,
  asked_at      timestamptz not null default now(),
  answered_at   timestamptz,
  unique (user_id, key)
);
create index if not exists check_ins_user_day_idx on check_ins (user_id, day);
alter table check_ins enable row level security;
