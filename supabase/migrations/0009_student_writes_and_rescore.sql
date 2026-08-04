-- Three fixes found by the final pre-use audit. Run after 0008. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- 1. A STUDENT WHO LEFT THE SIGN-UP PICKER ON "FACULTY" COULD NEVER SUBMIT.
--
-- "Faculty" is the pre-selected button. A student who does not change it gets
-- profiles.role = 'faculty'. The app self-heals the ROUTING — it claims their
-- roster row and shows them the student app — but the write policies gate on
-- is_student(), which reads profiles.role. So they saw their course, their
-- team and their assignments, and every Submit was rejected. profiles.role is
-- pinned against change by 0006, so there was no way out from inside the app.
--
-- is_student() now means "this account is a student on some course", which is
-- a fact about the roster rather than about a button they clicked once.
--
-- This does NOT re-open the escalation 0007 closed. That hole was: policy said
-- is_student(), trigger said is_student(), so picking the other button put you
-- outside both. The trigger now keys on can_grade_check_in() — course
-- OWNERSHIP — so widening the policy side cannot make anyone a grader.
create or replace function is_student() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'student')
      or exists (select 1 from students s where s.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 2. EDITING THE LADDER DID NOT RE-SCORE THE WORK ALREADY MARKED WITH IT.
--
-- score is a cache recomputed by recompute_result_score(), and 0007 put the
-- only trigger on submission_marks. So an instructor who corrected a
-- criterion's point value — "this should have been -2, not -3" — changed the
-- ladder and nothing else. Everyone already marked with that line kept a score
-- computed from the old value, while the screen showed the new one. Two
-- students with identical work ended up with different grades depending on when
-- they were marked.
create or replace function trg_rubric_rescore() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only the number matters; re-wording a criterion changes no arithmetic.
  if tg_op = 'UPDATE' and new.deduction is not distinct from old.deduction then
    return new;
  end if;

  perform recompute_result_score(m.result_id)
     from submission_marks m
    where m.rubric_item_id = coalesce(new.id, old.id);

  return coalesce(new, old);
end $$;

drop trigger if exists trg_rubric_items_rescore on rubric_items;
create trigger trg_rubric_items_rescore
  after update on rubric_items
  for each row execute function trg_rubric_rescore();

-- ---------------------------------------------------------------------------
-- 3. CHANGING AN ACTIVITY'S QUESTION SHAPE LEFT EVERY SCORE ON THE OLD TOTAL.
--
-- recompute_result_score computes `question_count * points_per_question` minus
-- the deductions taken. Changing the shape rewrote the total everywhere it is
-- DISPLAYED — including check_ins.max_points, which the student view renders —
-- but never the stored scores. An activity graded at 10x5 and then retyped to
-- 5x5 showed released marks of "45 / 25", and the gradebook's Total column
-- could exceed 100%.
create or replace function trg_activity_shape_rescore() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.question_count is not distinct from old.question_count
     and new.points_per_question is not distinct from old.points_per_question then
    return new;
  end if;

  for r in
    select res.id
      from check_in_results res
      join check_ins ci on ci.id = res.check_in_id
     where ci.activity_id = new.id
       and exists (select 1 from submission_marks m where m.result_id = res.id)
  loop
    perform recompute_result_score(r.id);
  end loop;

  return new;
end $$;

drop trigger if exists trg_activities_shape_rescore on activities;
create trigger trg_activities_shape_rescore
  after update on activities
  for each row execute function trg_activity_shape_rescore();
