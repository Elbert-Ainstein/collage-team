-- 0042: the check-in sheet says the instructor's NAME.
--
-- Run in Supabase → SQL Editor, after 0041. Safe to re-run.
--
-- 0041 made the instructor one of the names in the Grading TF dropdown, but the
-- app could only print the word "Instructor": profiles has been readable by its
-- own owner alone since 0006, so a TF asking who runs this course got nothing
-- back. A sheet that names seven TFs and one anonymous "Instructor" is the one
-- row nobody can tell you about at a glance.
--
-- The narrowest policy that fixes it: whoever may fill in a course's check-in
-- sheet may read THAT COURSE'S OWNER's profile row. Not every profile, not the
-- other way round — a student reads no profile but their own, and a TF still
-- cannot read another TF's. What it exposes is the instructor's name and role,
-- which is on the syllabus.

drop policy if exists "checkin staff read course owner" on profiles;
create policy "checkin staff read course owner" on profiles
  for select to authenticated using (
    exists (
      select 1 from courses c
       where c.owner_id = profiles.id
         and can_run_checkins_course(c.id)));
