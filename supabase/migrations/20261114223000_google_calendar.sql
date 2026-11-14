-- Google Calendar (#12, #13): the connected account's name for the You screen.
-- Tokens already live in integrations (access_token, refresh_token, expires_at, scope) and are
-- never returned by the API. Mirrors Integration in packages/shared/src/schemas.ts.
alter table integrations add column if not exists account text;
