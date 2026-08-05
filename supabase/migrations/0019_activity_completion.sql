-- Completion becomes a choice on the activity, not a property of its type.
--
-- Run in Supabase → SQL Editor, after 0018. Safe to re-run.
--
-- Until now "is this marked complete/incomplete, or out of points?" was decided
-- by a hard-coded map in the client:
--
--   IS_COMPLETION = { challenge: true, combo: false, amplify: true, skills: false }
--
-- so an instructor could not run a Challenge for points, or a Combo for
-- completion, however the course actually worked. It is a column now, and the
-- rubric step asks for it.
--
-- BACKFILLED FROM THE OLD MAP, not defaulted to false. Every activity that
-- exists was authored under the rule that its type decided this, and flipping a
-- term of Challenges from "complete" to "0 pts" would rewrite what students
-- have already been told they were marked on.

alter table activities add column if not exists completion boolean;

update activities
   set completion = (type in ('challenge', 'amplify'))
 where completion is null;

alter table activities alter column completion set default false;

-- Only after the backfill: a NOT NULL on a column with nulls in it fails.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'activities'
       and column_name = 'completion' and is_nullable = 'YES')
  then
    alter table activities alter column completion set not null;
  end if;
end $$;

-- ------------------------------------------------------------------- notes
--
-- What this does NOT change:
--
--   check_in_results.is_ci   still the per-result flag a release writes, and
--                            still what the gradebook and the student read.
--                            The activity column decides what to write there;
--                            it does not replace it.
--
--   activities.points_total  a completion activity may still carry a total.
--                            Nothing here zeroes it — an instructor switching
--                            back and forth should not lose what it was out of.
--
-- No RLS change: `completion` lives on `activities`, whose policies already say
-- who may read and write a row, and this is one more column of it.
