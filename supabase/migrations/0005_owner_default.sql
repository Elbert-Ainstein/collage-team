-- Let the database fill in the owner.
--
-- The client sets courses.owner_id explicitly, but that means any client that
-- forgets to — an older deployment still serving a pre-auth bundle, a script, a
-- future code path — inserts NULL and is rejected by the RLS policy with
-- "new row violates row-level security policy for table courses", which reads
-- like a permissions problem rather than a missing column.
--
-- Defaulting the column to auth.uid() makes the correct value the automatic
-- one. The policy is unchanged and still authoritative: it is impossible to
-- insert a course owned by anyone else, because the default only ever produces
-- the caller's own id and the WITH CHECK still compares against auth.uid().
--
-- Run in Supabase → SQL Editor, after 0004.

alter table courses alter column owner_id set default auth.uid();

-- Same reasoning is not needed elsewhere: every other table derives ownership
-- by walking up to courses, so nothing else stores an owner directly.
