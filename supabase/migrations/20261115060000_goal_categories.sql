-- Goals in three categories: business, health, personal (#131). Additive: the four older values
-- stay valid and readable (work = business; gym, rest, food = health) until every client has
-- moved. Removing them is a later migration, which first rewrites the rows that still use them.
-- Mirrors GoalCategory in packages/shared/src/schemas.ts.
--
-- A goal's kind, label and work categories live in goals.target (jsonb), so the table is unchanged.
-- Nothing here uses the new values: a value added to an enum cannot be used in the same transaction.
alter type goal_category add value if not exists 'business';
alter type goal_category add value if not exists 'health';
alter type goal_category add value if not exists 'personal';
