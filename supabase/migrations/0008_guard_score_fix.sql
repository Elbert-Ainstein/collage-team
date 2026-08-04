-- Fixes the grading guard, which was rejecting a legitimate student re-submit.
--
-- Run in Supabase → SQL Editor, after 0007. Safe to re-run.
--
-- THE BUG. 0007 made `score` derived: picking a rubric row fires a trigger that
-- writes check_in_results.score. The guard then said, for anyone who is not a
-- grader:
--
--     if new.score is not null then raise 'Students cannot set their own grade'
--
-- which reads as "a student may not put a score on a row" but actually means "a
-- student may not touch a row that HAS a score". So the moment an instructor
-- placed the first mark on a question — while the row is still `submitted`,
-- with the student's Submit button fully enabled — the student's next save died
-- with an error accusing them of trying to grade themselves. The same applied
-- to a teammate writing up the team answer after the discussion.
--
-- THE RULE IT SHOULD HAVE BEEN: a student may not SET or CHANGE a score. Whether
-- one is already there is the grader's business, not theirs.
--
-- Re-submitting after a mark also leaves the old marks attached to work that has
-- changed, so the score is recomputed to match the marks that remain. That is
-- the honest answer: the instructor's picks stand until they revisit them, and
-- `updated_at` moves so the row resurfaces as newly submitted.

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
  if new.check_in_id is distinct from old.check_in_id
     or new.subject_type is distinct from old.subject_type
     or new.student_id is distinct from old.student_id
     or new.team_id is distinct from old.team_id then
    raise exception 'A submission cannot be moved to a different check-in or owner';
  end if;
  if new.flagged is distinct from old.flagged then
    raise exception 'Only your instructor can change that';
  end if;
  if new.feedback is distinct from old.feedback then
    raise exception 'Only your instructor can leave feedback';
  end if;

  return new;
end $$;

-- A student submitting for the first time should stamp submitted_at themselves;
-- relying on the client to send it means an older bundle silently doesn't.
create or replace function stamp_submitted_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status in ('submitted', 'needs_review') and new.submitted_at is null then
    new.submitted_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_submitted_at on check_in_results;
create trigger trg_stamp_submitted_at
  before insert or update on check_in_results
  for each row execute function stamp_submitted_at();
