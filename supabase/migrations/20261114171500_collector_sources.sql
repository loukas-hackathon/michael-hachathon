-- Sources and event types for the local collectors (apps/collector, apps/extension).
-- Mirrors packages/shared/src/schemas.ts.

alter type event_source add value if not exists 'macos_usage';
alter type event_source add value if not exists 'iphone_usage';
alter type event_source add value if not exists 'chrome';
alter type event_source add value if not exists 'claude_code';

alter type event_type add value if not exists 'web_visit';
alter type event_type add value if not exists 'search';
alter type event_type add value if not exists 'notification';
alter type event_type add value if not exists 'screen';
alter type event_type add value if not exists 'ai_session';
alter type event_type add value if not exists 'ai_prompt';
