-- Puts back the check that stops a student clearing their own flag.
--
-- Run in Supabase → SQL Editor, after 0024. Safe to re-run.
--
-- 0024 rewrote guard_student_grading() to add the `ci_met` branch, and in doing
-- so lost a branch that had been in the function since 0006:
--
--     if new.flagged is distinct from old.flagged then
--       raise exception 'Only your instructor can change that';
--
-- `create or replace` replaces the WHOLE body, so a branch left out of the new
-- text is a branch deleted — silently, with nothing failing. Since 0024 was
-- applied, a student saving their own submission has been able to send
-- `flagged` along with it and turn off a flag an instructor raised on their
-- work. Nothing in the UI offers that, which is exactly why it would not have
-- surfaced on its own.
--
-- Below is 0024's function verbatim with the flagged branch back in its old
-- place. Nothing else moves.

create or replace function guard_student_grading() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if can_grade_check_in(new.check_in_id) then
    return new;
  end if;

  if new.status not in ('none', 'draft', 'submitted', 'discussing') then
    raise exception 'Students can submit work, but not grade it';
  end if;

  if tg_op = 'INSERT' then
    if new.score is not null then
      raise exception 'Students cannot set their own grade';
    end if;
    if new.is_ci then
      raise exception 'Students cannot set their own grade';
    end if;
    return new;
  end if;

  -- UPDATE. Compare against the old row: a score that is already there may stay
  -- there, it just may not move.
  if new.score is distinct from old.score then
    raise exception 'Students cannot change a grade';
  end if;
  if old.status = 'scored' then
    raise exception 'This has already been graded - ask your instructor to reopen it';
  end if;
  if new.is_ci is distinct from old.is_ci then
    raise exception 'Students cannot set their own grade';
  end if;
  if new.ci_met is distinct from old.ci_met then
    raise exception 'Students cannot set their own grade';
  end if;
  if new.check_in_id is distinct from old.check_in_id
     or new.subject_type is distinct from old.subject_type
     or new.student_id is distinct from old.student_id
     or new.team_id is distinct from old.team_id then
    raise exception 'A submission cannot be moved to another row';
  end if;
  if new.flagged is distinct from old.flagged then
    raise exception 'Only your instructor can change that';
  end if;
  if new.feedback is distinct from old.feedback then
    raise exception 'Only your instructor can leave feedback';
  end if;

  return new;
end $$;
