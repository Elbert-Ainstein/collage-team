-- Scope becomes a faculty choice, not a consequence of the type.
--
-- Until now the student view derived an activity's scope from its type
-- (SCOPE_OF in src/checkins/types.ts): a Challenge was always individual+team,
-- an Amplify always team. Faculty now pick the two independently in the
-- Activities tab, so the choice has to be stored.
--
-- Nullable on purpose: an existing row keeps behaving exactly as it did,
-- because the client falls back to the type's default when scope is null.
--
-- Run in Supabase → SQL Editor, after 0006.

alter table activities add column if not exists scope text
  check (scope in ('indiv', 'team', 'both'));
