-- One TF may write the criteria she grades against.
--
-- rubric_items and activity_questions were owner-only to write (0007, 0014):
-- a TF read them and marked against them. In practice the person marking is
-- the person who finds the rung that is worded wrong, or the question a
-- submission answers that nobody listed — and had to ask the instructor to
-- open the Rubric page and type it.
--
-- Scoped to one account by request, not to the grading switch. The rule is
-- still the grading rule — she must be on the TF list of the activity's
-- course with tf_can_grade on — with her address as a further condition, so
-- another TF added to the course later gets nothing here until this is
-- widened. The app cannot tell the two apart: it shows the pencil to every
-- TF who may grade, and the database is what refuses the others. To open it
-- to every TF who may grade, drop the email conditions and re-run.
--
-- Nothing about the activity itself opens up. Its title, total, completion
-- mode and attachments stay with the owner, so she can rewrite a ladder but
-- not what it is out of.

drop policy if exists "tf writes rubric_items" on rubric_items;
create policy "tf writes rubric_items" on rubric_items
  for all to authenticated
  using (
    lower(auth.jwt() ->> 'email') = 'elliewynkoop@college.harvard.edu'
    and exists (select 1 from activities a where a.id = rubric_items.activity_id
                  and can_grade_course(a.course_id)))
  with check (
    lower(auth.jwt() ->> 'email') = 'elliewynkoop@college.harvard.edu'
    and exists (select 1 from activities a where a.id = rubric_items.activity_id
                  and can_grade_course(a.course_id)));

drop policy if exists "tf writes activity_questions" on activity_questions;
create policy "tf writes activity_questions" on activity_questions
  for all to authenticated
  using (
    lower(auth.jwt() ->> 'email') = 'elliewynkoop@college.harvard.edu'
    and exists (select 1 from activities a where a.id = activity_questions.activity_id
                  and can_grade_course(a.course_id)))
  with check (
    lower(auth.jwt() ->> 'email') = 'elliewynkoop@college.harvard.edu'
    and exists (select 1 from activities a where a.id = activity_questions.activity_id
                  and can_grade_course(a.course_id)));

-- Table privileges are the floor under the policies. Both tables already
-- grant these to authenticated (0007, 0014); no-ops on a database that ran them.
grant select, insert, update, delete on rubric_items, activity_questions to authenticated;
