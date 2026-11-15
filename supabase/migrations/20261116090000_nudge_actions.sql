-- Nudges you can act on (#399): the buttons a nudge offers (Snooze, Mute an app, Do it) and the
-- one action taken from the notification or Telegram. acted_at is set once (single use) and cleared
-- when a snooze brings the nudge back. Mirrors Nudge in packages/shared/src/schemas.ts.
alter table nudges add column if not exists actions jsonb not null default '[]'::jsonb;
alter table nudges add column if not exists acted_action text
  check (acted_action is null or acted_action in ('open', 'snooze', 'mute_app', 'do_it'));
alter table nudges add column if not exists acted_at timestamptz;
