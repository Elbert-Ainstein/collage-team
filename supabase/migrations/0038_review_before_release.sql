-- Only the instructor releases a grade. A TF sends it for review.
--
-- Run in Supabase → SQL Editor, after 0037. Safe to re-run.
--
-- Kelly has one TF grading and wants to look his marks over before anything
-- reaches a student. The app now gives a TF "Send for review" where it gave
-- "Release", and gives her a Review tab that releases what he sent. This is
-- the rule behind that, in the database, so the app hiding a button is not
-- the only thing standing between a TF and a released grade.
--
-- `needs_review` already exists as a status (0001) and the student app already
-- reads it as "Turned in" — the same thing it says for `submitted` — so a row
-- sent for review changes nothing on the student's screen. The TF's marks are
-- on submission_marks and the score is the cache 0007 recomputes from them,
-- both written as they always were; only the last step moves.
--
-- What a non-owner may not do, on a row of a course they do not own:
--   - write status = 'scored' unless it already was (they may still leave
--     feedback on a released row — that write keeps status where it is);
--   - move a released row OFF 'scored'. Un-releasing is releasing's undo, and
--     it would also be the way round the next rule: change the answer and the
--     status together, and a check that only looks at rows that stay released
--     sees nothing;
--   - change is_ci or ci_met on a released row, which is how a completion is
--     re-finalised from Complete to Not complete or back.
-- Everything else stays as 0007 and 0025 left it: a TF who may grade writes
-- marks, feedback, flags and 'needs_review'; a student writes their own work.
--
-- owns_check_in exists since 0004 as security invoker. Redefined here as
-- security definer like can_grade_check_in: a TF's session may not be able to
-- read the course row this has to look at, and a guard that cannot see the
-- owner would refuse the owner too.
--
-- A trigger rather than a policy, and a second trigger rather than a branch in
-- guard_student_grading: 0025 is the story of what `create or replace` does
-- to a branch somebody forgets to carry over. This one is small, separate,
-- and reads as one rule.
--
-- recompute_result_score (0007) updates score and updated_at on this table in
-- the grader's own session, and fires this. It never touches status, is_ci or
-- ci_met, so it passes — a TF re-marking a released row still re-scores it,
-- exactly as before.

create or replace function owns_check_in(ciid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from check_ins ci
      join activities a on a.id = ci.activity_id
     where ci.id = ciid and owns_course(a.course_id));
$$;
grant execute on function owns_check_in(uuid) to authenticated;

create or replace function guard_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if owns_check_in(new.check_in_id) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'scored' then
      raise exception 'Only the instructor can release a grade - send it for review instead';
    end if;
    return new;
  end if;

  if new.status = 'scored' and old.status is distinct from 'scored' then
    raise exception 'Only the instructor can release a grade - send it for review instead';
  end if;
  if old.status = 'scored' then
    if new.status is distinct from 'scored' then
      raise exception 'Only the instructor can take back a released grade';
    end if;
    if new.is_ci is distinct from old.is_ci or new.ci_met is distinct from old.ci_met then
      raise exception 'Only the instructor can change a released grade';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_release on check_in_results;
create trigger trg_guard_release
  before insert or update on check_in_results
  for each row execute function guard_release();
