-- Let an instructor deleting an activity take its files with it.
--
-- Run in Supabase → SQL Editor, after 0017. Safe to re-run.
--
-- FK cascades reach rows. They do not reach storage objects. So deleting an
-- activity already left its audio behind until 0013 added a widened remove
-- permission and a client-side sweep — and the three buckets added since have
-- the same hole:
--
--   submissions  (0015)  a student's PDF; only the student could remove it
--   resources    (0017)  a team's photos; only the team could remove them
--   activity-files (0012) the assignment document
--
-- The last one is the worst, and not merely an orphan. Its only write policy
-- joins back to the activity row (`a.id = activity_of_object(name)`), so once
-- the activity is deleted the predicate can never be true again and the object
-- is unreachable by ANYONE, forever. It has to be swept before the row goes,
-- which is what the client now does — this migration is what makes the other
-- two sweepable at all.
--
-- Nothing here widens who can READ anything.

-- ------------------------------------------------------------- submissions
/**
 * May the caller remove this submission's PDF?
 *
 * Its owner, as before — plus whoever owns the check-in it hangs off, so
 * deleting an activity can take the PDFs with it. Deliberately the same shape
 * as 0013's can_remove_result_audio, and for the identical reason: the rows
 * cascade away and would leave the objects invisible, unlistable, and still
 * counted against storage.
 */
create or replace function can_remove_result_file(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_remove_result_audio(rid);
$$;

grant execute on function can_remove_result_file(uuid) to authenticated;

-- The row policy: was can_remove_result_audio already, which is correct. The
-- storage policy on the bucket was too. Restated so a project that ran 0015
-- before this file still ends up in the same place.
drop policy if exists "replace submission_files" on submission_files;
create policy "replace submission_files" on submission_files
  for delete to authenticated using (can_remove_result_audio(result_id));

drop policy if exists "delete submission objects" on storage.objects;
create policy "delete submission objects" on storage.objects
  for delete to authenticated
  using (bucket_id = 'submissions' and can_remove_result_audio(recording_result_id(name)));

-- --------------------------------------------------------------- resources
/**
 * May the caller remove this team's resource?
 *
 * Its team, as before — plus the course owner, so deleting an activity or a
 * team set can take the photos with it. NOT any TF: a team's record of their
 * own discussion is not a grader's to remove, and reading it is enough to mark
 * with. can_write_team_resources is left alone, so ADDING is still the team's
 * alone; this only widens removal.
 */
create or replace function can_remove_team_resource(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_write_team_resources(tid)
      or exists (
        select 1
          from teams t
          join team_sets ts on ts.id = t.team_set_id
         where t.id = tid and owns_course(ts.course_id));
$$;

grant execute on function can_remove_team_resource(uuid) to authenticated;

drop policy if exists "delete team_resources" on team_resources;
create policy "delete team_resources" on team_resources
  for delete to authenticated using (can_remove_team_resource(team_id));

drop policy if exists "delete resource objects" on storage.objects;
create policy "delete resource objects" on storage.objects
  for delete to authenticated
  using (bucket_id = 'resources' and can_remove_team_resource(resource_team_id(name)));
