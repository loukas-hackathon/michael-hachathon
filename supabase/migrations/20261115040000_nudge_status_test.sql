-- Stage view (#44): POST /v1/nudges/test stores its nudge with status 'test' so the screen can
-- show it as the watch buzzes. 'test' never counts towards the 5 a day (apps/api nudges engine).
alter type nudge_status add value if not exists 'test';
