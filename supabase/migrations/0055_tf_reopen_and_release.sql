-- 0055: a TF who grades reopens hand-ins and releases grades.
--
-- Run in Supabase → SQL Editor, after 0054. Safe to re-run.
--
-- Two asks from Kelly's grading TF, Diego, and Kelly agreed to both.
--
-- REOPENING (0044 made it the owner's alone). The late requests reach the TF
-- doing the marking, who then had to pass every one on to Kelly. Now any TF
-- who may grade on the course (can_grade_course, 0007) can reopen a student's
-- hand-in and close it again, under the same rules: one row per (activity,
-- student), for a student on that course, and it does not move the deadline.
-- Work handed in through a reopen still shows as Late.
--
-- RELEASING (0038 made it the owner's alone). Diego sent each grade for
-- review and Kelly released it from the Review tab. Both find the extra step
-- in the way now, so it becomes a course switch, courses.tf_can_release:
--   - on (the default, and every existing course): a TF who may grade
--     releases, takes back and changes a released grade, as the owner does.
--   - off: 0038 exactly. The TF sends for review and only the owner releases.
-- A course that wants the review step back flips it on the TFs page.

-- ---------------------------------------------------------------- prereqs
do $$
begin
  if to_regclass('public.hand_in_reopens') is null then
    raise exception 'Missing hand_in_reopens -- run 0044 before this file.';
  end if;
  if to_regprocedure('public.guard_release()') is null then
    raise exception 'Missing guard_release() -- run 0038 before this file.';
  end if;
end $$;

-- ------------------------------------------------------------- reopening
/**
 * May the caller reopen this activity for this student?
 *
 * 0044's question, with "the course owner" widened to anyone who may grade the
 * course. Still only for a student on the activity's own course.
 */
create or replace function can_reopen(aid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activities a
      join students s on s.course_id = a.course_id
     where a.id = aid and s.id = sid and can_grade_course(a.course_id));
$$;

/** May the caller close a reopen on this activity? Whoever may open one. */
create or replace function can_close_reopen(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activities a
     where a.id = aid and can_grade_course(a.course_id));
$$;

grant execute on function can_reopen(uuid, uuid), can_close_reopen(uuid) to authenticated;

-- The insert policy already asks can_reopen; recreated so its name says who.
drop policy if exists "owner reopens" on hand_in_reopens;
drop policy if exists "grader reopens" on hand_in_reopens;
create policy "grader reopens" on hand_in_reopens
  for insert to authenticated
  with check (created_by = auth.uid() and can_reopen(activity_id, student_id));

drop policy if exists "owner closes" on hand_in_reopens;
drop policy if exists "grader closes" on hand_in_reopens;
create policy "grader closes" on hand_in_reopens
  for delete to authenticated
  using (can_close_reopen(activity_id));

-- -------------------------------------------------------------- releasing
alter table courses add column if not exists tf_can_release boolean not null default true;

/**
 * May the caller release grades on this check-in?
 *
 * The owner always. A TF when they may grade it and the course lets TFs
 * release.
 */
create or replace function can_release_check_in(ciid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owns_check_in(ciid)
      or (can_grade_check_in(ciid)
          and exists (
            select 1 from check_ins ci
              join activities a on a.id = ci.activity_id
              join courses c on c.id = a.course_id
             where ci.id = ciid and c.tf_can_release));
$$;

grant execute on function can_release_check_in(uuid) to authenticated;

-- 0038's guard with its first line asking can_release_check_in instead of
-- owns_check_in. Everything after it is unchanged.
create or replace function guard_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if can_release_check_in(new.check_in_id) then
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
