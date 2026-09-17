-- 0039: a released grade comes with its rubric.
--
-- The Review tab releases a score a trigger computed from per-question marks
-- (0007), but the student could only ever read the number: rubric_items and
-- submission_marks had owner and TF policies only, so the breakdown that
-- explains "15 / 20" was invisible to the person it is about.
--
-- Both policies below hang off the same fact — this student has a RELEASED
-- result on the work — rather than off the activity being open:
--
--   * The marks are the grading itself, so they follow the grade exactly:
--     released is the moment a judgement becomes the student's to read (0038),
--     and a mark readable any earlier is a half-finished judgement in front
--     of the person it is about.
--   * The ladder is the instructor's marking scheme. Whether students see it
--     BEFORE being graded is the instructor's call to make some day, not a
--     side effect of this migration — so it too becomes readable only once a
--     released grade exists to read it against.
--
-- Additive, like every student policy since 0006: permissive policies OR
-- together, so faculty and TFs keep exactly the access they had.

-- Their own individual work and their team's — never a classmate's.
drop policy if exists "student reads own released marks" on submission_marks;
create policy "student reads own released marks" on submission_marks
  for select to authenticated
  using (exists (
    select 1 from check_in_results r
     where r.id = submission_marks.result_id
       and r.status = 'scored'
       and (
         (r.subject_type = 'student'
            and r.student_id in (select s.id from students s where s.user_id = auth.uid()))
         or (r.subject_type = 'team' and r.team_id in (select my_team_ids()))
       )
  ));

drop policy if exists "student reads rubric of released work" on rubric_items;
create policy "student reads rubric of released work" on rubric_items
  for select to authenticated
  using (exists (
    select 1 from check_in_results r
      join check_ins c on c.id = r.check_in_id
     where c.activity_id = rubric_items.activity_id
       and r.status = 'scored'
       and (
         (r.subject_type = 'student'
            and r.student_id in (select s.id from students s where s.user_id = auth.uid()))
         or (r.subject_type = 'team' and r.team_id in (select my_team_ids()))
       )
  ));
