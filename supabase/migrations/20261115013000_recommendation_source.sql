-- Chat actions (#46): a recommendation the user asked for in chat (or by voice) and Michael carried
-- out straight away is stored with source 'chat', so it shows on Today and can be undone there too.
alter table recommendations add column if not exists source text not null default 'analysis';
