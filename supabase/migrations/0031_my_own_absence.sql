-- A student may read their OWN absence, and nobody else's.
--
-- Run in Supabase → SQL Editor, after 0030. Safe to re-run.
--
-- 0016 closed tutorial_absences to students entirely, on the grounds that who
-- was away is a fact about them rather than about you. That still holds for
-- everyone else's rows and this does not touch them.
--
-- What changed is what an absence MEANS. A check-in score used to be the team's;
-- it is now the student's — everyone in the room gets the team's numbers for
-- that check-in, and anyone ticked absent gets 0. So a student's own absence row
-- is no longer only a fact about them, it is the difference between the 5 their
-- team was given and the 0 they were. Without this policy their card reads the
-- team's number back at them and is simply wrong.
--
-- Read-only, and gated on the activity being open, exactly like the marks policy
-- it sits beside. Nothing here lets a student untick their own absence.

drop policy if exists "student reads own tutorial_absences" on tutorial_absences;
create policy "student reads own tutorial_absences" on tutorial_absences
  for select to authenticated
  using (
    student_id in (select s.id from students s where s.user_id = auth.uid())
    and exists (
      -- Qualified for the same reason 0016 qualifies it: an unqualified
      -- activity_id here reads as the outer column only because `activities`
      -- happens not to have one.
      select 1 from activities a
       where a.id = tutorial_absences.activity_id and activity_open(a.opens_at))
  );
