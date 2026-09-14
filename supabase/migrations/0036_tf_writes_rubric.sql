-- A TF who may grade may write the criteria they grade against.
--
-- rubric_items and activity_questions were owner-only to write (0007, 0014):
-- a TF read them and marked against them. In practice the person marking is
-- the person who finds the rung that is worded wrong, or the question a
-- submission answers that nobody listed — and had to ask the instructor to
-- open the Rubric page and type it. The change follows the grading switch
-- rather than adding a third one: tf_can_grade already says "this TF's
-- judgement goes on transcripts", and the criteria are the same judgement
-- written down once instead of eighty times.
--
-- Nothing about the activity itself opens up. Its title, total, completion
-- mode and attachments stay with the owner (and, for posting, the check-in
-- permission), so a TF can rewrite a ladder but not what it is out of.

drop policy if exists "tf writes rubric_items" on rubric_items;
create policy "tf writes rubric_items" on rubric_items
  for all to authenticated
  using (exists (select 1 from activities a where a.id = rubric_items.activity_id
                   and can_grade_course(a.course_id)))
  with check (exists (select 1 from activities a where a.id = rubric_items.activity_id
                   and can_grade_course(a.course_id)));

drop policy if exists "tf writes activity_questions" on activity_questions;
create policy "tf writes activity_questions" on activity_questions
  for all to authenticated
  using (exists (select 1 from activities a where a.id = activity_questions.activity_id
                   and can_grade_course(a.course_id)))
  with check (exists (select 1 from activities a where a.id = activity_questions.activity_id
                   and can_grade_course(a.course_id)));

-- Table privileges are the floor under the policies. rubric_items got its
-- grant in 0007 for the owner's sake; activity_questions in 0014. Both cover
-- authenticated already, so these are no-ops on a database that ran them.
grant select, insert, update, delete on rubric_items, activity_questions to authenticated;
