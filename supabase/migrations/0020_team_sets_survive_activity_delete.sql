-- Deleting an activity must not delete the course's teams.
--
-- Run in Supabase → SQL Editor, after 0019. Safe to re-run.
--
-- THE BUG. 0001 declared:
--
--   team_sets.activity_id uuid references activities(id) on delete cascade
--
-- and teams cascade from team_sets, team_members and check_in_results.team_id
-- cascade from teams. So deleting ONE activity that a team set happened to be
-- filed under took the whole set with it — every team, every membership, and
-- every team result the course had recorded against those teams ON EVERY OTHER
-- ACTIVITY. A term of team marks, gone, because an instructor deleted an
-- unrelated week's work. Nothing warned: the delete confirm counts only that
-- activity's own submissions.
--
-- The storage half is worse than the data half is recoverable. recordings and
-- team_resources hang off rows that cascade away, and both removal predicates
-- (can_remove_result_audio in 0013, can_remove_team_resource in 0018) read the
-- very rows that have just gone — so the audio and the photos become
-- unreachable by anyone, forever. The client sweeps cannot help: they are
-- scoped to the activity being deleted, and these belong to other activities.
--
-- THE FIX. `activity_id` on a team set means "these teams were formed FOR this
-- activity" — a label, not an owner. The app already treats a set with a NULL
-- activity_id as the course-wide one, so releasing the label is exactly the
-- right outcome: the teams survive, their results survive, and the set simply
-- stops naming an activity that no longer exists.

alter table team_sets drop constraint if exists team_sets_activity_id_fkey;

alter table team_sets
  add constraint team_sets_activity_id_fkey
  foreign key (activity_id) references activities(id) on delete set null;

-- ------------------------------------------------------------------- notes
--
-- Anything ALREADY orphaned by the old cascade cannot be repaired from here:
-- the rows that named those storage objects are gone, so there is nothing left
-- to list them from. They are invisible and unbilled-for-nothing in the
-- `recordings` and `resources` buckets. Clearing them needs the storage admin
-- API with the service key, which is deliberately not something this app holds.
--
-- Not changed: team_sets.course_id still cascades from courses (0001), which is
-- correct — deleting a course really should take its teams.
