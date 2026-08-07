-- Amplify gains an individual half.
--
-- Run in Supabase → SQL Editor, after 0022. Safe to re-run.
--
-- SCOPE_OF.amplify changes from 'team' to 'both' in the client, so an Amplify
-- activity now works like a Challenge: students hand in their own work AND the
-- team is checked in on it.
--
-- Scope decides which check_ins must exist. Every Amplify activity created
-- before this change has only its TEAM check-in — so without this migration the
-- new Individual tab shows "Not open for submissions yet" on every one of them,
-- and no student can hand anything in. ensureCheckIn only runs when somebody
-- re-saves the activity, which nobody has a reason to do.
--
-- So: give every existing Amplify its missing individual row, matching exactly
-- what ensureCheckIn would have written (facultyData.ts) — label 'iRAT',
-- position 0, and max_points/scale from the activity's own total.

insert into check_ins (activity_id, label, kind, scale, max_points, posted, position)
select a.id,
       'iRAT',
       'individual',
       -- ensureCheckIn: points when there is a total, complete/incomplete when
       -- there is not. Reading the activity rather than guessing keeps the two
       -- halves of one activity saying the same thing.
       case when coalesce(a.points_total, 0) > 0 then 'points' else 'ci' end,
       coalesce(a.points_total, 0),
       a.posted,
       0
  from activities a
 where a.type = 'amplify'
   -- Idempotent: skip any that already have one, which is what makes this safe
   -- to re-run and safe on a project where somebody re-saved an activity by hand.
   and not exists (
     select 1 from check_ins c
      where c.activity_id = a.id and c.kind = 'individual');

-- ------------------------------------------------------------------- notes
--
-- Nothing is deleted. The team check-in stays exactly as it was, with every
-- result, recording and mark already recorded against it — narrowing scope has
-- never dropped a check-in in this app, and widening it must not either.
--
-- One consequence worth knowing: an Amplify activity's headline status on a
-- student's list now reads from their INDIVIDUAL result rather than the team's
-- (listAssignments picks the lead by scope). A team activity that was marked
-- complete will read "Not started" for a student who has not handed in their
-- own half — which is true, and is the point of the change.
