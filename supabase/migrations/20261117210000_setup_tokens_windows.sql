-- Windows PCs connect with a setup token too (GET /v1/setup/windows.ps1).
alter table setup_tokens drop constraint if exists setup_tokens_connection_check;
alter table setup_tokens
  add constraint setup_tokens_connection_check
  check (connection in ('mac', 'windows', 'apple-watch', 'iphone'));
