-- Who may write a rubric, asked once and answered in one place.
--
-- 0036 let one TF write criteria, by email, and left the app unable to tell:
-- it showed the pencil to every TF who may grade and let the database refuse
-- the rest with an error. The rule now lives in a function the policies use
-- AND the app asks on load, so the two cannot disagree — and widening it later
-- (to every TF who may grade, say) is one edit here and nothing in the app.
--
-- Security definer, like can_grade_course: the caller may not be able to read
-- courses or course_tfs directly, and the answer is a boolean about herself.

create or replace function can_write_rubric(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owns_course(cid)
      or (lower(coalesce(auth.jwt() ->> 'email', '')) = 'elliewynkoop@college.harvard.edu'
          and can_grade_course(cid));
$$;
grant execute on function can_write_rubric(uuid) to authenticated;

drop policy if exists "tf writes rubric_items" on rubric_items;
create policy "tf writes rubric_items" on rubric_items
  for all to authenticated
  using (exists (select 1 from activities a where a.id = rubric_items.activity_id
                   and can_write_rubric(a.course_id)))
  with check (exists (select 1 from activities a where a.id = rubric_items.activity_id
                   and can_write_rubric(a.course_id)));

drop policy if exists "tf writes activity_questions" on activity_questions;
create policy "tf writes activity_questions" on activity_questions
  for all to authenticated
  using (exists (select 1 from activities a where a.id = activity_questions.activity_id
                   and can_write_rubric(a.course_id)))
  with check (exists (select 1 from activities a where a.id = activity_questions.activity_id
                   and can_write_rubric(a.course_id)));
